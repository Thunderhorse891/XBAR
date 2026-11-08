// Joining whitespace here can concatenate an adjacent pedigree year
// ("AQHA #1234567 1962") into an identifier. Read one complete token.
export function readRegistryIdentifiers(text, registries) {
  const pattern = new RegExp('\\b(' + registries.join('|') + ')\\s*[:#-]?\\s*(\\d[\\d-]{3,}\\d[A-Z]*)\\b', 'gi');
  return [...text.matchAll(pattern)].map((match) => ({
    registry: match[1].toUpperCase(),
    number: match[2].replace(/-/g, '').toUpperCase(),
  }));
}
