Pod::Spec.new do |s|
  s.name         = 'CDSGoogleAuth'
  s.version      = '0.0.1'
  s.summary      = 'Google auth-code flow native module'
  s.homepage     = 'https://github.com/crown-dev-studios/simple-auth'
  s.license      = { :type => 'MIT' }
  s.author       = 'Crown Dev Studios'
  s.platform     = :ios, '18.0'
  s.source       = { :git => 'https://github.com/crown-dev-studios/simple-auth.git', :tag => s.version.to_s }
  s.source_files = [
    'ios/**/*.{h,m,mm,swift}',
    '../google-auth-native-ios/Sources/GoogleAuthNative/**/*.swift',
  ]
  s.requires_arc = true
  s.swift_version = '6.2'
  s.dependency 'React-Core'
  s.dependency 'GoogleSignIn'
end
