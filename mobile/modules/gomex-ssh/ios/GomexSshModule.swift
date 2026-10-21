import Citadel
import CryptoKit
import ExpoModulesCore
import Foundation
import NIOCore

/// Open sessions by id: the setup screens keep one for the server they're setting up.
private actor Sessions {
  private var clients: [String: SSHClient] = [:]

  func add(_ client: SSHClient) -> String {
    let id = UUID().uuidString
    clients[id] = client
    return id
  }

  func get(_ id: String) -> SSHClient? { clients[id] }

  func remove(_ id: String) -> SSHClient? { clients.removeValue(forKey: id) }
}

/// Why a connection failed, as a short code the JS side turns into words (desktop/server-setup.js sshError).
private func reason(_ error: Error) -> String {
  let text = String(describing: error).lowercased()
  if text.contains("auth") { return "auth" }
  if text.contains("unknown host") || text.contains("nodename") || text.contains("resolve") || text.contains("no address") { return "noHost" }
  if text.contains("timeout") || text.contains("timed out") || text.contains("refused") || text.contains("unreachable")
    || text.contains("connection reset") || text.contains("eof") || text.contains("closed")
  {
    return "noReply"
  }
  return "other: \(error)"
}

/// The OpenSSH line for an ed25519 public key: "ssh-ed25519 BASE64 comment".
private func openSSHLine(_ key: Curve25519.Signing.PublicKey, comment: String) -> String {
  func field(_ bytes: [UInt8]) -> [UInt8] {
    let n = UInt32(bytes.count).bigEndian
    return withUnsafeBytes(of: n) { Array($0) } + bytes
  }
  let blob = field(Array("ssh-ed25519".utf8)) + field(Array(key.rawRepresentation))
  return "ssh-ed25519 \(Data(blob).base64EncodedString()) \(comment)"
}

public class GomexSshModule: Module {
  private let sessions = Sessions()

  public func definition() -> ModuleDefinition {
    Name("GomexSsh")

    /// A fresh ed25519 key for the app: the public half for authorized_keys, the private one (raw, base64) for the Keychain.
    Function("generateKey") { () -> [String: String] in
      let key = Curve25519.Signing.PrivateKey()
      return [
        "publicKey": openSSHLine(key.publicKey, comment: "gomex-app"),
        "privateKey": key.rawRepresentation.base64EncodedString(),
      ]
    }

    /// Random bytes as base64url, for passwords the app makes up (deSEC).
    Function("randomToken") { (bytes: Int) -> String in
      var data = Data(count: bytes)
      _ = data.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, bytes, $0.baseAddress!) }
      return data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
    }

    /// Logs in with a password or the app's key; resolves with the session's id, or rejects with a reason code.
    /// The host key isn't pinned: a fresh VPS has never been seen before, as in the desktop app.
    AsyncFunction("connect") { (host: String, port: Int, user: String, password: String?, privateKey: String?) async throws -> String in
      let auth: SSHAuthenticationMethod
      if let privateKey, let raw = Data(base64Encoded: privateKey) {
        auth = .ed25519(username: user, privateKey: try Curve25519.Signing.PrivateKey(rawRepresentation: raw))
      } else {
        auth = .passwordBased(username: user, password: password ?? "")
      }
      do {
        let client = try await SSHClient.connect(
          host: host,
          port: port,
          authenticationMethod: auth,
          hostKeyValidator: .acceptAnything(),
          reconnect: .never,
          connectTimeout: .seconds(20)
        )
        return await sessions.add(client)
      } catch {
        throw Exception(name: "SSHConnect", description: reason(error))
      }
    }

    /// Runs a command: its exit code and its output (stdout and stderr together, the last 256 KB at most).
    AsyncFunction("exec") { (id: String, command: String) async throws -> [String: Any] in
      guard let client = await sessions.get(id) else {
        throw Exception(name: "SSHExec", description: "noReply")
      }
      var output = ByteBuffer()
      var code = 0
      do {
        let stream = try await client.executeCommandStream(command)
        for try await chunk in stream {
          switch chunk {
          case .stdout(var buffer), .stderr(var buffer):
            output.writeBuffer(&buffer)
          }
          if output.readableBytes > 512 * 1024 {
            output.moveReaderIndex(forwardBy: output.readableBytes - 256 * 1024)
            output.discardReadBytes()
          }
        }
      } catch let failed as SSHClient.CommandFailed {
        code = failed.exitCode
      } catch {
        throw Exception(name: "SSHExec", description: reason(error))
      }
      return ["code": code, "output": String(buffer: output)]
    }

    AsyncFunction("close") { (id: String) async in
      if let client = await sessions.remove(id) {
        try? await client.close()
      }
    }
  }
}
