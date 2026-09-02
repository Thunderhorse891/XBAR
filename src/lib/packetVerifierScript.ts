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
  function label(key) {
    return String(key)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/^./, function (first) {
        return first.toUpperCase();
      });
  }
  function describe(out, value, indent, key) {
    if (value === null || value === undefined) {
      out.push(indent + label(key) + ': none');
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        out.push(indent + label(key) + ': none');
        return;
      }
      out.push(indent + label(key) + ':');
      for (var i = 0; i < value.length; i += 1) describe(out, value[i], indent + '  ', String(i + 1));
      return;
    }
    if (typeof value === 'object') {
      if (key !== undefined) out.push(indent + label(key) + ':');
      var keys = Object.keys(value);
      for (var k = 0; k < keys.length; k += 1)
        describe(out, value[keys[k]], key === undefined ? indent : indent + '  ', keys[k]);
      return;
    }
    out.push(indent + label(key) + ': ' + String(value));
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
        /*
         * EVERY link in the packet, not the ones that agreed to be checked.
         *
         * The selector used to be 'a[data-xbar-file]', and that attribute is
         * ordinary HTML an alterer controls. Appending a link WITHOUT it —
         * styled into the file list beside the real ones, labelled "Coggins
         * 2026" — left every sealed link intact, every digest matching, and the
         * verdict PASS, while the buyer clicked content the seal had never seen.
         * The previous fix hardened the marked links; this is its complement,
         * because an attacker who has to mark their forgery to have it checked
         * simply will not.
         *
         * Safe to sweep the whole document because the generator emits no other
         * anchors at all — the packet's only links are its attachments — and
         * the packetVerifierCsp test fails if one is ever added without
         * revisiting this.
         */
        var anchors = [].slice.call(document.querySelectorAll('a'));
        var links = [];
        var unmarked = [];
        for (var a = 0; a < anchors.length; a += 1) {
          if (anchors[a].getAttribute('data-xbar-file') === null) unmarked.push(anchors[a]);
          else links.push(anchors[a]);
        }

        return Promise.all(
          links.map(function (link) {
            var href = link.getAttribute('href') || '';
            var fileName = link.getAttribute('download') || '';
            var id = link.getAttribute('data-xbar-file');
            /*
             * The link has to BE the bytes, not merely end with them.
             *
             * This used to hash everything after the first comma, whatever the
             * link was. An altered packet pointing a link at
             * 'https://attacker.example/file,<the original base64>' therefore
             * hashed the original suffix and matched the seal, so the verifier
             * said PASS while clicking the link fetched unsealed content from
             * somewhere else entirely. That is the one failure this whole file
             * exists to make impossible: a packet that lies and proves it.
             *
             * A base64 data: URL carries its bytes inline, so what is hashed is
             * necessarily what the buyer receives. Anything else cannot be
             * verified at all, and unverifiable is reported as a problem rather
             * than skipped — silence here reads as a pass.
             */
            var marker = ';base64,';
            var at = href.slice(0, 5).toLowerCase() === 'data:' ? href.indexOf(marker) : -1;
            if (at < 0) {
              return Promise.resolve({ id: id, fileName: fileName, digest: null, embedded: false });
            }
            var bytes;
            try {
              bytes = bytesOf(href.slice(at + marker.length));
            } catch (error) {
              // Undecodable base64 is the same answer: these are not bytes this
              // packet can vouch for.
              return Promise.resolve({ id: id, fileName: fileName, digest: null, embedded: false });
            }
            return hash(bytes).then(function (digest) {
              return { id: id, fileName: fileName, digest: digest, embedded: true };
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
            if (file.embedded === false) {
              problems.push(
                'The file "' +
                  file.fileName +
                  '" is not embedded in this packet — its link points somewhere else, so these are not the bytes that were sealed.',
              );
              return;
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

          unmarked.forEach(function (link) {
            var label = (link.textContent || '').trim() || link.getAttribute('href') || 'an unnamed link';
            problems.push(
              'This packet contains a link ("' +
                label +
                '") that is not part of the sealed record, so it was added after this packet was sealed. Do not open it.',
            );
          });

          notes.push(found.length ? 'Files rehashed from this packet: ' + found.length : 'No embedded files to rehash.');

          /*
           * The watermark on the page, against the one in the record.
           *
           * The generic readout below already PRINTS the sealed watermark, so a
           * careful reader could spot a mismatch. This says it outright,
           * because the watermark is the one sealed fact a buyer cannot check
           * against anything else: an ask price or a transfer status can be
           * queried with the seller, but "whose copy is this" has no second
           * source. It is also the fact a leaker has the clearest motive to
           * edit, and editing it is silent — the payload is untouched, so the
           * digest still matches.
           */
          var stamp = document.getElementById('xbar-watermark');
          if (parsed && typeof parsed.watermark === 'string') {
            var shown = stamp ? (stamp.textContent || '').trim() : '';
            if (!stamp) {
              problems.push('The buyer watermark has been removed from this packet. It was sealed as "' + parsed.watermark + '".');
            } else if (shown !== parsed.watermark) {
              problems.push('This packet is stamped "' + shown + '" but was sealed for "' + parsed.watermark + '".');
            }
          }

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
            notes.push('');
            notes.push('Every fact this seal covers, read out of the sealed record:');
            /*
             * EVERY field, walked generically — not a hand-picked list.
             *
             * The curated version printed nine facts, so an attacker could edit
             * the displayed breed, colour, owner entity, compliance deadline,
             * a blocker, or a document title, leave the payload untouched, and
             * the digest still matched while none of those edits appeared here.
             * The check said pass over a page that lied.
             *
             * Walking the payload means the readout is the sealed record, whole.
             * A field added to the credential next year shows up without anyone
             * remembering to add it here, which is exactly the kind of drift a
             * curated list guarantees.
             */
            describe(notes, parsed, '  ');
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
