"""Disposable Debug simulator probe. Never use for release packaging."""
import base64
from pathlib import Path
import sys

entry, swift, js = map(Path, sys.argv[1:])
program = base64.b64encode(js.read_bytes()).decode("ascii")
e = entry.read_text()
coordinate = "if (!usesHashRouting()) {"
if e.count(coordinate) != 1:
    raise SystemExit("Unexpected app entry; no instrumentation applied")
e = e.replace(coordinate, """;(window as Window & { __xbarQaModuleEntered?: () => void }).__xbarQaModuleEntered?.();
""" + coordinate, 1)
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
            source: String(decoding: Data(base64Encoded: "__PROBE_BASE64__")!, as: UTF8.self),
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
              phase == "lifecycle-summary", fields["kind"] is NSNull,
              let summary = fields["asset"] as? String,
              summary.range(of: #"^(local|about|other)(-[01]){5}-(none|script|module|rejection)$"#,
                            options: .regularExpression) != nil else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: fields),
              let json = String(data: data, encoding: .utf8) else { return }
        received += 1
        logger.notice("XBAR_BOOT \(json, privacy: .public)")
    }
}
#endif
'''
entry.write_text(e)
swift.write_text(s.replace("__PROBE_BASE64__", program))
