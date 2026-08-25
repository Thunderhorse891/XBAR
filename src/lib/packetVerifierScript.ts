// The sale packet's self-verification script, kept in its own module.
//
// Two reasons it is not inlined in the generator any more.
//
// The deployed CSP is `script-src 'self' 'wasm-unsafe-eval' blob:` — no
// `unsafe-inline`, no nonce. A packet opened from the on-device vault is a blob
// document created by the XBAR page, so it INHERITS that policy, and the inline
// script was silently blocked: the "Recompute from this packet" button did
// nothing for anyone opening a saved packet inside the app. An external script
// was not an option — the packet is emailed, carried on a USB stick and opened
// from `file://`, where there is nothing to fetch — so the script stays inline
// in the document and its exact hash is allowlisted in `vercel.json` instead.
//
// Which is the second reason: a CSP hash covers exact bytes. Isolating those
// bytes in one exported constant, with nothing else in the file, means the hash
// has one obvious source. `tests/packetVerifierCsp.test.ts` recomputes it and
// fails with the value to paste if this text changes, so an edit here cannot
// quietly re-break the button on the deployed site.

/*
 * The packet verifies itself, from its own contents.
 *
 * Before this, the packet printed a seal and told the buyer that comparing it
 * with the seller's copy proved the packet was unaltered. That was false. The
 * seal is text in the file; whoever swapped an embedded Coggins for a clean one
 * could leave the seal untouched, and the buyer's comparison still matched. The
 * packet published a conclusion nobody could check.
 *
 * So the sealed record is published in full, and this recomputes the digest
 * from it AND rehashes every embedded file out of its own data URL, comparing
 * the result against what the record says was sealed. A swapped file now shows
 * as ALTERED.
 *
 * What this script cannot do is authenticate itself: anyone able to edit the
 * attachments can edit this code too. That is why the copy presents the by-hand
 * route as the real one and this button as the convenience, and why both end at
 * the same instruction — compare the RECOMPUTED code with the seal the seller
 * supplied through some other channel. That comparison is the only step an
 * attacker holding the file cannot forge.
 *
 * No escape sequences anywhere below: this source is emitted inside a template
 * literal, so a newline is written as String.fromCharCode(10) rather than being
 * quietly turned into a real line break inside a JavaScript string.
 */
export const PACKET_VERIFIER_SCRIPT = `
(function () {
  var btn = document.getElementById('xbar-verify-btn');
  var out = document.getElementById('xbar-verify-out');
  var record = document.getElementById('xbar-credential-payload');
  if (!btn || !out || !record) return;
  var NL = String.fromCharCode(10);
  var sealed = out.getAttribute('data-digest') || '';

  function show(state, text) {
    out.setAttribute('data-state', state);
    out.textContent = text;
  }
  function hex(buffer) {
    var view = new Uint8Array(buffer);
    var text = '';
    for (var i = 0; i < view.length; i += 1) text += ('0' + view[i].toString(16)).slice(-2);
    return text;
  }
  function hash(bytes) {
    return crypto.subtle.digest('SHA-256', bytes).then(hex);
  }
  function bytesOf(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function sealOf(digest) {
    var head = digest.slice(0, 12).toUpperCase();
    return 'SEAL-' + head.slice(0, 4) + '-' + head.slice(4, 8) + '-' + head.slice(8, 12);
  }

  btn.addEventListener('click', function () {
    if (!window.crypto || !crypto.subtle || !window.TextEncoder) {
      show('fail', 'This browser will not recompute hashes for a local file. Use the by-hand steps below instead.');
      return;
    }
    btn.disabled = true;
    show('', 'Recomputing...');

    var problems = [];
    var notes = [];
    var payload = record.textContent || '';

    hash(new TextEncoder().encode(payload))
      .then(function (digest) {
        notes.push('Recomputed SHA-256: ' + digest);
        notes.push('Recomputed seal code: ' + sealOf(digest));
        if (digest !== sealed) problems.push('The sealed record does not match the seal printed on this packet.');

        var parsed = null;
        try {
          parsed = JSON.parse(payload);
        } catch (error) {
          problems.push('The sealed record is not readable, so the files cannot be checked against it.');
        }
        var expected = (parsed && parsed.attachments) || [];
        var links = [].slice.call(document.querySelectorAll('a[data-xbar-file]'));

        return Promise.all(
          links.map(function (link) {
            var href = link.getAttribute('href') || '';
            return hash(bytesOf(href.slice(href.indexOf(',') + 1))).then(function (digest) {
              return {
                id: link.getAttribute('data-xbar-file'),
                fileName: link.getAttribute('download') || '',
                digest: digest,
              };
            });
          }),
        ).then(function (found) {
          found.forEach(function (file) {
            var match = null;
            for (var i = 0; i < expected.length; i += 1) {
              if (expected[i].id === file.id) {
                match = expected[i];
                break;
              }
            }
            if (!match) {
              problems.push('The file "' + file.fileName + '" is not in the sealed record at all.');
              return;
            }
            if (match.digest !== file.digest) {
              problems.push('The file "' + file.fileName + '" is not the one that was sealed.');
            }
            if (match.fileName !== file.fileName) {
              problems.push('The file "' + file.fileName + '" was sealed under the name "' + match.fileName + '".');
            }
          });
          expected.forEach(function (match) {
            for (var i = 0; i < found.length; i += 1) if (found[i].id === match.id) return;
            problems.push('The file "' + match.fileName + '" was sealed but is missing from this packet.');
          });

          notes.push(found.length ? 'Files rehashed from this packet: ' + found.length : 'No embedded files to rehash.');
          btn.disabled = false;

          /*
           * Read the sealed facts back OUT of the record, rather than trusting
           * the ones printed on the page.
           *
           * Everything above the seal is ordinary HTML: an ask price, a
           * transfer status and the 'Sealed facts' list beside them are all
           * editable text, and editing them alone left the digest intact and
           * this check passing. Printing the values the digest actually covers
           * is what makes that edit visible — an attacker cannot change these
           * without changing the record, and changing the record fails the hash
           * two lines up.
           */
          if (parsed) {
            var money = typeof parsed.sale.askPrice === 'number' && parsed.sale.askPrice > 0
              ? '$' + parsed.sale.askPrice.toLocaleString()
              : 'no ask price';
            notes.push('');
            notes.push('The facts this seal covers, read out of the sealed record:');
            notes.push('  Name: ' + (parsed.identity.name || 'unnamed'));
            notes.push('  Registration: ' + (parsed.identity.registered
              ? ((parsed.identity.registry || 'registry') + ' ' + (parsed.identity.registrationNumber || '')).trim()
              : 'not registered'));
            notes.push('  Microchip: ' + (parsed.identity.microchipId || 'none recorded'));
            notes.push('  Ask price: ' + money + ' (' + (parsed.sale.listingState || 'unlisted') + ')');
            notes.push('  Legal owner: ' + (parsed.ownership.legalOwner || 'unknown'));
            notes.push('  Transfer status: ' + (parsed.ownership.transferStatus || 'unknown'));
            notes.push('  Horse status: ' + (parsed.care.status || 'unknown'));
            notes.push('  Last vet visit: ' + (parsed.care.lastVetVisit || 'none recorded'));
            notes.push('  Release verdict: ' + (parsed.release.status || 'unknown'));
            notes.push('  Sealed ' + (parsed.sealedAt || '') + ' by ' + (parsed.sealedBy || 'unknown'));
            notes.push('');
            notes.push('If anything printed on the page above differs from this list, the page was edited and this list is what was sealed.');
          }

          if (problems.length) {
            show('fail', 'ALTERED. This packet does not match its own seal.' + NL + NL + problems.join(NL) + NL + NL + notes.join(NL));
            return;
          }
          show(
            'pass',
            'This packet matches the seal printed on it, and every embedded file is the one that was sealed.' +
              NL + NL + notes.join(NL) + NL + NL +
              'One step left, and it is the one that matters: compare the recomputed seal code above with the code the seller gave you directly. If those differ, the packet was altered and re-sealed.',
          );
        });
      })
      .catch(function (error) {
        btn.disabled = false;
        show('fail', 'Could not finish the check: ' + ((error && error.message) || error) + NL + NL + 'Use the by-hand steps below instead.');
      });
  });
})();
`;
