require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'CapacitorCommunitySqlite'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = package['repository']['url']
  s.author = package['author']
  s.source = { :git => package['repository']['url'], :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  # SQLCipher 4.11.0 removed CocoaPods support ("Removes CocoaPods support
  # (SQLCipher.podspec.json)" in its CHANGELOG), so 4.10.0 is the last version published to
  # the CocoaPods trunk and this pod can never advance past it. Pinned rather than left open
  # so CocoaPods resolution is deterministic and the ceiling is visible. Swift Package Manager
  # (Package.swift) carries the current SQLCipher and is the path that stays in step with
  # Android; see the iOS section of the README.
  s.dependency 'SQLCipher', '4.10.0'
  s.dependency 'ZIPFoundation'
  s.swift_version = '5.1'
end
