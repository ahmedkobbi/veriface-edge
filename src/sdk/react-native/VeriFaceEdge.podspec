Pod::Spec.new do |s|
  s.name         = "VeriFaceEdge"
  s.version      = "1.0.0"
  s.summary      = "VeriFace Edge — Privacy-first facial authentication SDK for React Native."
  s.description  = <<-DESC
                   VeriFace Edge wraps the web SDK via WebView, providing iOS/Android
                   facial authentication with 100% biometric computation in the browser layer.
                   All crypto (Ed25519, X25519, AES-256-GCM, BLAKE3) and AI (MediaPipe, rPPG, PAD)
                   run via WebGPU/WASM in the system WebView.
                   DESC
  s.homepage     = "https://veriface.io"
  s.license      = { :type => "MIT", :file => "LICENSE" }
  s.author       = { "VeriFace" => "support@veriface.io" }
  s.platform     = :ios, "13.0"
  s.source       = { :git => "https://github.com/veriface/edge-sdk-react-native.git", :tag => s.version.to_s }
  s.source_files = "src/**/*.{ts,tsx}"
  s.dependency   "React-Core"
  s.dependency   "react-native-webview"
  s.static_framework = true
end
