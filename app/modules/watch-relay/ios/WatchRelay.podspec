Pod::Spec.new do |s|
  s.name           = 'WatchRelay'
  s.version        = '1.0.0'
  s.summary        = 'Relays Apple Watch messages to the KovaLink daemon'
  s.author         = 'KovaLink'
  s.homepage       = 'https://github.com/robbydrop13'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '17.0' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks     = 'WatchConnectivity', 'Security'
  s.source_files   = '**/*.swift'
end
