# SSH for "Your own server" on the phone: Citadel (SwiftNIO SSH), pulled in through Swift Package Manager.
Pod::Spec.new do |s|
  s.name           = 'AtriumSsh'
  s.version        = '0.1.0'
  s.summary        = 'SSH client for Atrium setup'
  s.author         = 'Atrium'
  s.homepage       = 'https://github.com/atriumchat/atrium'
  s.license        = 'AGPL-3.0-only'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.swift_version  = '5.9'
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.swift'
  # 0.11.x: 0.12 needs iOS 17, the app runs from 16.4.
  spm_dependency(s,
    url: 'https://github.com/orlandos-nl/Citadel.git',
    requirement: { kind: 'exactVersion', version: '0.11.1' },
    products: ['Citadel']
  )
end
