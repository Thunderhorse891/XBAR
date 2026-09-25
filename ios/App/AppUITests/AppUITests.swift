import XCTest

final class AppUITests: XCTestCase {
    func testBundledSignInScreen() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let webView = app.webViews.firstMatch
        XCTAssertTrue(webView.waitForExistence(timeout: 30), "The bundled WKWebView must load")
        let email = webView.textFields.firstMatch
        XCTAssertTrue(email.waitForExistence(timeout: 30), "The real sign-in form must render")
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
