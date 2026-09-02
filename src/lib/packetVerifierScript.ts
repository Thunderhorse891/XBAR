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
  var NL = String.fromCharCode(10);
  /*
   * A missing piece used to return in silence, which is the failure a
   * verifier can least afford: the button does nothing and a forged verdict
   * sits beside it unchallenged. There is nowhere to print here, so the one
   * channel left is a dialog.
   */
  if (!btn || !out || !record) {
    try {
      if (btn) {
        btn.addEventListener('click', function () {
          window.alert(
            'This packet is missing the part of itself that reports the result, so it cannot be checked here. Use the by-hand steps in the packet instead.',
          );
        });
      }
    } catch (error) {
      // Nothing further is possible.
    }
    return;
  }
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

  /*
   * The page controls how this check is DISPLAYED, so the page has to be
   * checked too.
   *
   * Every sweep above asks whether the sealed content changed. None of them
   * asked whether the packet can still show the answer honestly, and CSS alone
   * is enough to lie about it: hide the output element and draw a PASS with a
   * pseudo-element, and an altered packet reads as verified while this script
   * runs correctly and reports ALTERED into an invisible box. A style element
   * is not an embedded resource and does not raise the script count, so
   * neither of those sweeps sees it.
   *
   * A sealed packet has exactly one stylesheet, whose bytes are fixed for
   * every packet the generator emits, and no element carries a style attribute
   * of its own. STYLE_SHA256 is the digest of that stylesheet; the
   * packetVerifierCsp test fails if it drifts from what the generator writes.
   */
  var STYLE_SHA256 = '6392de31e04b9d6a1c2862856b988871fe60454f5a519247e050a2d12f516ea3';

  /*
   * Said out loud, because the in-page verdict is exactly what is in doubt.
   *
   * A dialog is the one channel the page cannot restyle away. It is reserved
   * for the case where the packet has taken control of its own appearance —
   * an ordinary ALTERED verdict is still printed in the box, because in that
   * case the box can be believed.
   */
  function warnAloud(list) {
    try {
      window.alert(
        'This packet controls how this check is displayed.' +
          NL + NL +
          list.join(NL) +
          NL + NL +
          'Nothing shown on the page can be trusted, including the result printed below it. Use the by-hand steps in the packet instead.',
      );
    } catch (error) {
      // A browser that refuses dialogs still gets the printed verdict below.
    }
  }

  function styleText() {
    var sheets = [].slice.call(document.querySelectorAll('style'));
    var text = '';
    for (var i = 0; i < sheets.length; i += 1) text += sheets[i].textContent || '';
    return text;
  }

  /*
   * Checked before crypto.subtle is, because a file opened from disk often has
   * no crypto.subtle at all — and that path returns early, into the same box
   * an added stylesheet can hide. Counting elements needs no crypto.
   */
  /*
   * The box the verdict lands in has to BE the box the buyer reads.
   *
   * Sealing the stylesheet closed the CSS route and only that route. The
   * native hidden attribute hides an element with no CSS, no extra script and
   * no embedded resource, so an altered packet could mark the result box
   * hidden, append an ordinary element reading PASS, and let this script write
   * its real verdict where nobody would see it. A duplicate id does the same
   * thing from the other end: getElementById returns the first, so the verdict
   * goes into a decoy while the visible one keeps its forged text.
   *
   * The measurement is the rule that does not depend on naming a mechanism,
   * which is the mistake the CSS-only sweep already made once. A box occupying
   * no space is not showing anyone anything, whatever was done to it.
   */
  function outputProblems() {
    var found = [];

    var named = document.querySelectorAll('#xbar-verify-out');
    if (named.length !== 1) {
      found.push(
        'This packet contains ' +
          named.length +
          ' elements claiming to be the result box. A sealed packet contains one, so the verdict below may have been written into a copy you cannot see.',
      );
    }

    for (var node = out; node; node = node.parentElement) {
      if (node.getAttribute && node.getAttribute('hidden') !== null) {
        found.push(
          'The result box on this packet, or something containing it, is marked hidden. Whatever is printed below was put somewhere you were not meant to read it.',
        );
        break;
      }
      if (String(node.tagName || '').toUpperCase() === 'DETAILS' && !node.open) {
        found.push('The result box on this packet is inside a collapsed section, so the verdict below is not on screen.');
        break;
      }
    }

    if (typeof out.getBoundingClientRect === 'function') {
      var box = out.getBoundingClientRect();
      if (box && !box.width && !box.height) {
        found.push('The result box on this packet takes up no space on the page, so the verdict below is not visible.');
      }
    }

    return found;
  }

  function presentationProblems() {
    var found = outputProblems();
    var sheets = document.querySelectorAll('style');
    if (sheets.length !== 1) {
      found.push(
        'This packet contains ' +
          sheets.length +
          ' stylesheets. A sealed packet contains exactly one, so the rest were added after it was sealed.',
      );
    }
    var inline = document.querySelectorAll('[style]');
    if (inline.length) {
      found.push(
        'This packet contains ' +
          inline.length +
          ' element(s) carrying a style attribute. A sealed packet contains none, so they were added after it was sealed.',
      );
    }
    return found;
  }

  btn.addEventListener('click', function () {
    var presentation = presentationProblems();
    if (presentation.length) {
      warnAloud(presentation);
      show(
        'fail',
        'ALTERED. This packet controls how this check is displayed.' +
          NL + NL +
          presentation.join(NL) +
          NL + NL +
          'Do not trust anything this page shows you, including this line. Use the by-hand steps below instead.',
      );
      return;
    }
    if (!window.crypto || !crypto.subtle || !window.TextEncoder) {
      show('fail', 'This browser will not recompute hashes for a local file. Use the by-hand steps below instead.');
      return;
    }
    btn.disabled = true;
    show('', 'Recomputing...');

    var problems = [];
    var notes = [];
    var payload = record.textContent || '';

    var styleAltered = false;

    hash(new TextEncoder().encode(styleText()))
      .then(function (styleDigest) {
        /*
         * Counting stylesheets catches one that was ADDED. This catches the
         * one that was edited in place, which keeps the count at one and
         * leaves every other sweep on this page satisfied.
         */
        if (styleDigest !== STYLE_SHA256) styleAltered = true;
        return hash(new TextEncoder().encode(payload));
      })
      .then(function (digest) {
        if (styleAltered) {
          var altered = ['The stylesheet in this packet is not the one that was sealed.'];
          warnAloud(altered);
          problems.push(altered[0] + ' It decides what you see, so the verdict printed here cannot be trusted either.');
        }
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

          /*
           * A link is not the only way to put unsealed content in front of a
           * buyer. An added img or iframe SHOWS it without anything being
           * clicked, and the anchor sweep above never sees one.
           *
           * This matters most where the packet is most likely to be read: a
           * file opened from disk, where the deployment's CSP does not apply
           * and an added element loads from anywhere.
           *
           * A sealed packet embeds nothing but its own attachments — the
           * generator emits no img, iframe, embed, object, video, audio,
           * source, link or svg at all, which is what makes "any of these is an
           * alteration" a fact about this format rather than a guess. The
           * packetVerifierCsp test fails if the generator ever grows one.
           */
          var EMBEDS =
            'img,iframe,embed,object,video,audio,source,track,link,base,svg,frame,frameset,applet,portal,form';
          [].slice.call(document.querySelectorAll(EMBEDS)).forEach(function (node) {
            var from =
              node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('data') || '';
            problems.push(
              'This packet contains an added ' +
                String(node.tagName || 'element').toLowerCase() +
                ' element' +
                (from ? ' loading "' + from + '"' : '') +
                ', which the seal does not cover. A sealed packet embeds nothing but its own attachments, so this was put here after it was sealed. Do not trust what it shows you.',
            );
          });

          /*
           * Exactly one script: the checker being run. More than one means
           * something else is running in this page — which could rewrite what
           * is printed below. It cannot prove its own innocence, and says so;
           * the by-hand instructions in the packet are the answer to that.
           */
          var scripts = [].slice.call(document.querySelectorAll('script'));
          if (scripts.length > 1) {
            problems.push(
              'This packet contains ' +
                scripts.length +
                ' scripts. A sealed packet contains exactly one, the checker you just ran, so the rest were added after sealing. Verify this packet by hand using the instructions above.',
            );
          }

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
