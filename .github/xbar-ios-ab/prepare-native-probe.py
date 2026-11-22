"""Disposable Debug simulator probe. Never use for release packaging."""
import json
from pathlib import Path
import sys

swift, js = map(Path, sys.argv[1:])
s = swift.read_text()
anchor = "        window?.rootViewController = CAPBridgeViewController()"
if s.count(anchor) != 1 or "import Capacitor" not in s:
    raise SystemExit("Unexpected scene controller; no instrumentation applied")
s = s.replace("import Capacitor", "import Capacitor\nimport WebKit\nimport os", 1)
s = s.replace(anchor, """        #if DEBUG && targetEnvironment(simulator)
        window?.rootViewController = StartupProbeViewController()
        #else
""" + anchor + """
        #endif""", 1)
s += r'''
#if DEBUG && targetEnvironment(simulator)
private final class StartupProbeViewController: CAPBridgeViewController {
    override func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        configuration.userContentController.add(StartupProbeSink(), name: "xbarBoot")
        configuration.userContentController.addUserScript(WKUserScript(
            source: "window.webkit.messageHandlers.xbarBoot.postMessage({phase:'native-document-start',kind:null,asset:null});",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))
        return super.webView(with: frame, configuration: configuration)
    }
}

private final class StartupProbeSink: NSObject, WKScriptMessageHandler {
    private let logger = Logger(subsystem: "com.xbar.ranch", category: "StartupProbe")
    private var received = 0

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, received < 12,
              let fields = message.body as? [String: Any], fields.count == 3,
              let phase = fields["phase"] as? String,
              ["native-document-start", "html-script", "script-error", "resource-error", "unhandled-rejection",
               "dom-ready", "root-missing", "root-populated", "root-still-empty"].contains(phase),
              let kind = fields["kind"], let asset = fields["asset"] else { return }
        if !(kind is NSNull) {
            guard let name = kind as? String,
                  ["Error", "TypeError", "SyntaxError", "ReferenceError", "RangeError", "SecurityError",
                   "NetworkError", "AbortError"].contains(name) else { return }
        }
        if !(asset is NSNull) {
            guard let file = asset as? String,
                  file.range(of: #"^[A-Za-z0-9_-]{1,96}\.(js|css)(:[0-9]{1,7}:[0-9]{1,7})?$"#,
                             options: .regularExpression) != nil else { return }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: fields),
              let json = String(data: data, encoding: .utf8) else { return }
        received += 1
        logger.notice("XBAR_BOOT \(json, privacy: .public)")
    }
}
#endif
'''
j = js.read_text()
anchor = "    console.info('XBAR_BOOT ' + record);"
if j.count(anchor) != 1:
    raise SystemExit("Unexpected probe JS; no instrumentation applied")
j = j.replace(anchor, """
    var native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.xbarBoot;
    if (native) native.postMessage(JSON.parse(record));
""" .strip("\n"), 1)
swift.write_text(s)
js.write_text(j)
