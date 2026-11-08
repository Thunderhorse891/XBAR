// Joining whitespace here can concatenate an adjacent pedigree year
// ("AQHA #1234567 1962") into an identifier. Read one complete token.
export function readRegistryIdentifiers(text, registries) {
  const pattern = new RegExp('\\b(' + registries.join('|') + ')\\s*[:#-]?\\s*(\\d(?:[\\d-]*\\d)?[A-Z]*)\\b', 'gi');
  return [...text.matchAll(pattern)].flatMap((match) => {
    // Neither a split ID nor an adjacent unlabelled year can be resolved from
    // flattened text alone. Do not turn the first fragment into a new ID.
    const ambiguous = /^\s+\d/.test(text.slice(match.index + match[0].length));
    const number = match[2].replace(/-/g, '').toUpperCase();
    // A short isolated token was not a supported ID before this change.
    // Still retain its ambiguity when it is the first fragment of a split ID.
    if (!ambiguous && number.replace(/[A-Z]/g, '').length < 5) return [];
    return [
      {
        registry: match[1].toUpperCase(),
        number: ambiguous ? undefined : number,
        ambiguous,
      },
    ];
  });
}
