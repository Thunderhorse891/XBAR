"""Add only post-failure, exact-label AX observations to disposable XCTest source."""
import sys
from pathlib import Path

path = Path(sys.argv[1])
source = path.read_text()

def replace_once(old, new):
    global source
    if source.count(old) != 1:
        raise SystemExit("Unexpected XCTest source; no instrumentation applied")
    source = source.replace(old, new, 1)

replace_once("final class AppUITests: XCTestCase {", r'''final class AppUITests: XCTestCase {
    private var emailWaitStarted: TimeInterval?
    private var emailWaitEnded: TimeInterval?

    private func observeAXAfterEmailFailure(_ app: XCUIApplication) {
        guard let started = emailWaitStarted, let ended = emailWaitEnded else { return }
        let sampleStart = ProcessInfo.processInfo.systemUptime
        let sampleBudget: TimeInterval = 8
        let label = NSPredicate(format: "label == %@", "Email or User ID")
        let signInViews = app.webViews.containing(.other, identifier: "Sign in | XBAR")
        let views = app.webViews
        func report(_ probe: String, _ count: () -> Int) {
            let before = ProcessInfo.processInfo.systemUptime
            guard before - sampleStart < sampleBudget else {
                print("XBAR_AX probe=\(probe) skipped=sample-budget")
                return
            }
            let value = min(99, count())
            let after = ProcessInfo.processInfo.systemUptime
            print("XBAR_AX probe=\(probe) count=\(value) afterWaitMs=\(Int((before - ended) * 1000)) queryMs=\(Int((after - before) * 1000))")
        }
        print("XBAR_AX emailWaitMs=\(Int((ended - started) * 1000))")
        // Emit only safe counts. The original failure artifact remains unchanged.
        report("original-first-match") { views.firstMatch.textFields["Email or User ID"].exists ? 1 : 0 }
        report("app-exact-label") { app.textFields.matching(label).count }
        report("sign-in-titled-webviews") { signInViews.count }
        report("first-webview-exact-label") { views.firstMatch.textFields.matching(label).count }
        // A nested WebView chain can match the same document more than once.
        report("first-sign-in-webview-exact-label") {
            signInViews.firstMatch.textFields.matching(label).count
        }
        report("webview-count") { views.count }
    }''')
# Avoid declaring success or rerunning the predicate: collect only after the
# unchanged XCT assertion has already constructed its failure issue.
replace_once("        super.record(issue)", '''        super.record(issue)
        // XCT may terminate test execution here when continueAfterFailure
        // is false. In that case the original failure and screenshot win.
        if issue.compactDescription.contains("The real sign-in form must render") {
            observeAXAfterEmailFailure(app)
        }''')
replace_once("        let emailRendered = email.waitForExistence(timeout: 30)", '''        emailWaitStarted = ProcessInfo.processInfo.systemUptime
        let emailRendered = email.waitForExistence(timeout: 30)
        emailWaitEnded = ProcessInfo.processInfo.systemUptime''')
path.write_text(source)
