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
        let email = webView.textFields["Email or User ID"]
        let emailRendered = email.waitForExistence(timeout: 30)
        XCTAssertTrue(emailRendered, "The real sign-in form must render")
        let password = webView.secureTextFields["Password"]
        XCTAssertTrue(password.exists)
        // WKWebView exposes the CSS-transformed uppercase label. The captured
        // native accessibility tree confirms this exact button, not a missing form.
        let signIn = webView.buttons["SIGN IN"]
        let emailCode = webView.buttons["Email me a sign-in code"]
        XCTAssertTrue(signIn.exists)
        XCTAssertTrue(emailCode.exists)
        XCTAssertFalse(signIn.isEnabled)
        XCTAssertFalse(emailCode.isEnabled)
        XCTAssertFalse(webView.buttons["Google"].exists)
        XCTAssertFalse(webView.buttons["Facebook"].exists)
        email.tap()
        email.typeText("native-smoke@example.invalid")
        XCTAssertEqual(email.value as? String, "native-smoke@example.invalid")
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: emailCode)
        waitForExpectations(timeout: 10)
        XCTAssertFalse(signIn.isEnabled, "Email alone must not enable password sign-in")
        password.tap()
        password.typeText("native-smoke-password")
        expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: signIn)
        waitForExpectations(timeout: 10)
        // No submit: CI uses synthetic configuration and must never create an account.
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "XBAR-native-sign-in"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
