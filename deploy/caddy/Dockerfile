# Caddy plus the layer4 app (caddy-l4), so public port 443 can carry both the website and
# TURN-over-TLS for calls — to a censor or a strict firewall, both look like ordinary HTTPS.
# Go cross-compiles: the arm64 image is built on the build machine's own CPU, not under emulation.
FROM --platform=$BUILDPLATFORM caddy:2.11.7-builder AS builder
ARG TARGETOS TARGETARCH
RUN GOOS=$TARGETOS GOARCH=$TARGETARCH xcaddy build --with github.com/mholt/caddy-l4@v0.1.2

FROM caddy:2.11.7
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
