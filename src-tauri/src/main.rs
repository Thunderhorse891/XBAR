use tauri;

mod {
    pub fn main() {
        tauri::builder()
            .with_state() // Remember to call .state(ctl)
            .run(none);
    }
}
