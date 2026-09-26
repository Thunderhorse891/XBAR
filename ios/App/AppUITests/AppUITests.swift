import XCTest

final class AppUITests: XCTestCase {
    func testBundledSignInScreen() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let webView = app.webViews.firstMatch
        XCTAssertTrue(webView.waitForExistence(timeout: 30), "The bundled WKWebView must load")
        let email = webView.textFields.firstMatch
        let emailRendered = email.waitForExistence(timeout: 30)
        if !emailRendered {
            // Capture the actual native page before XCTest stops at the assertion.
            // CI runs only with synthetic configuration and never signs in.
            print("XBAR startup accessibility tree:\n\(app.debugDescription)")
            let failureScreenshot = XCTAttachment(screenshot: app.screenshot())
            failureScreenshot.name = "XBAR-startup-failure"
            failureScreenshot.lifetime = .keepAlways
            add(failureScreenshot)
        }
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
