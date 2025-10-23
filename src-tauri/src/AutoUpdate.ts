import { checkForUpdates } from tauri;

export async function autoUpdate() {
  const result = await checkForUpdates();
  if (result.available) {
    result.onUpdate(() => {
      console.log('Starting update.');
    });
  }
}