import XCTest

final class AppUITests: XCTestCase {
    override func record(_ issue: XCTIssue) {
        // Retain the page for every failing assertion, including controls that
        // appear after the email field. This app uses synthetic CI data only.
        let app = XCUIApplication()
        print("XBAR native failure accessibility tree:\n\(app.debugDescription)")
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "XBAR-native-failure"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        super.record(issue)
    }

    func testBundledSignInScreen() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let webView = app.webViews.firstMatch
        XCTAssertTrue(webView.waitForExistence(timeout: 30), "The bundled WKWebView must load")
        let email = webView.textFields.firstMatch
        let emailRendered = email.waitForExistence(timeout: 30)
        XCTAssertTrue(emailRendered, "The real sign-in form must render")
        XCTAssertTrue(webView.secureTextFields.firstMatch.exists)
        XCTAssertTrue(webView.buttons["Sign In"].exists)
        XCTAssertTrue(webView.buttons["Email me a sign-in code"].exists)
        XCTAssertFalse(webView.buttons["Google"].exists)
        XCTAssertFalse(webView.buttons["Facebook"].exists)
        email.tap()
        email.typeText("native-smoke@example.invalid")
        XCTAssertEqual(email.value as? String, "native-smoke@example.invalid")
        // No submit: CI uses synthetic configuration and must never create an account.
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "XBAR-native-sign-in"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
