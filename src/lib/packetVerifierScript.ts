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
    /*
     * Said NOW, not on a click. Attaching the warning to the button was the
     * mistake: a packet missing only the button entered this guard, skipped
     * the nested check, and returned in silence with a forged verdict still on
     * screen. The element that may be absent cannot be the thing that reports
     * its own absence.
     */
    var missingNotice =
      'This packet is missing the part of itself that reports the result, so it cannot be checked here. Use the by-hand steps in the packet instead.';
    try {
      window.alert(missingNotice);
    } catch (error) {
      // A browser that refuses dialogs still gets whatever is printed below.
    }
    try {
      if (out) {
        out.setAttribute('data-state', 'fail');
        out.textContent = 'ALTERED. ' + missingNotice;
      }
    } catch (error) {
      // There may be nowhere to print, which is why the dialog came first.
    }
    try {
      if (btn) {
        btn.addEventListener('click', function () {
          try {
            window.alert(missingNotice);
          } catch (inner) {
            // Nothing further is possible.
          }
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
   * The same stylesheet measured without crypto.
   *
   * The digest is the real check and it needs crypto.subtle, which a packet
   * opened from disk often does not have — and that is exactly where an
   * altered stylesheet can hide the verify button so the digest never runs at
   * all. Counting bytes catches every edit that changes the length, needs
   * nothing, and runs while the script arms.
   */
  var STYLE_BYTES = 3740;

  /*
   * Said out loud, because the in-page verdict is exactly what is in doubt.
   *
   * A dialog is the one channel the page cannot restyle away. It is reserved
   * for the case where the packet has taken control of its own appearance —
   * an ordinary ALTERED verdict is still printed in the box, because in that
   * case the box can be believed.
   */
  var saidAlready = '';

  function warnAloud(list) {
    /*
     * Said once. The sweep runs at arming and again on the click, so without
     * this the same alteration produces the same dialog twice — and a warning
     * a buyer has to dismiss repeatedly is one they learn to dismiss. A list
     * that has GROWN still speaks, because that is new information.
     */
    var joined = list.join(NL);
    if (joined === saidAlready) return;
    saidAlready = joined;
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
  /*
   * The box has to be the SEALED box, not merely a box.
   *
   * Measuring the rectangle was supposed to be the rule that did not name a
   * mechanism. It was not: the sealed stylesheet contains a rule that conceals
   * things, and an altered packet only has to point at it. Change the class to
   * watermark and the verdict renders at six percent alpha, rotated, fixed,
   * behind the content — with a perfectly ordinary rectangle, no stylesheet
   * touched, no inline style, no hidden attribute. So the class and the chain
   * of elements above it are pinned to what the generator emits, and the
   * packetVerifierCsp test derives that chain from the generator so the two
   * cannot drift.
   */
  var SEALED_OUT_CHAIN = [
    ['DIV', 'verify__out'],
    ['DIV', 'verify'],
    ['SECTION', 'seal'],
    ['DIV', 'content'],
    ['DIV', 'packet'],
  ];

  function classOf(node) {
    var value = node && node.getAttribute ? node.getAttribute('class') : null;
    return String(value === null || value === undefined ? '' : value).replace(/^ +| +$/g, '');
  }

  function outputProblems(withGeometry) {
    var found = [];

    var node = out;
    for (var level = 0; level < SEALED_OUT_CHAIN.length; level += 1) {
      var wantTag = SEALED_OUT_CHAIN[level][0];
      var wantClass = SEALED_OUT_CHAIN[level][1];
      if (!node || String(node.tagName || '').toUpperCase() !== wantTag || classOf(node) !== wantClass) {
        found.push(
          'The result box on this packet is not where the seal put it, or is no longer styled as itself. Its appearance is under the control of whoever changed it, so nothing printed in it can be trusted.',
        );
        break;
      }
      node = node.parentElement;
    }

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

    /*
     * Measured only on the click, deliberately.
     *
     * Everything else here reads the document; this reads the LAYOUT, and
     * layout is not guaranteed to be meaningful while the page is still
     * parsing — a box that has not been laid out reports zero. Accusing an
     * honest packet of hiding its own verdict is the failure that teaches a
     * buyer to ignore the warning, so the geometry waits for the click, by
     * which time the page has certainly settled. The checks that can answer
     * from the document alone do not wait.
     */
    var box =
      withGeometry && typeof out.getBoundingClientRect === 'function' ? out.getBoundingClientRect() : null;
    if (box && !box.width && !box.height) {
      found.push('The result box on this packet takes up no space on the page, so the verdict below is not visible.');
    }

    /*
     * And nothing may be painted over it. A forged PASS cannot be detected by
     * its text, but one COVERING the real verdict can be, and that is the
     * arrangement that actually deceives a reader.
     */
    if (box && box.width && box.height && typeof document.elementFromPoint === 'function') {
      var top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      var reachesOut = false;
      for (var over = top; over; over = over.parentElement) {
        if (over === out) {
          reachesOut = true;
          break;
        }
      }
      // A null result means the box is simply off screen, which is not an
      // alteration — only something drawn IN FRONT of it is.
      if (top && !reachesOut) {
        found.push('Something on this packet is drawn on top of the result box, so what you are reading there may not be what this check produced.');
      }
    }

    return found;
  }

  function presentationProblems(withGeometry) {
    var found = outputProblems(withGeometry);
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
    if (styleText().length !== STYLE_BYTES) {
      found.push('The stylesheet in this packet is not the size it was sealed at, so it is not the one that was sealed.');
    }
    return found;
  }

  /*
   * Checked when this script ARMS, not when the button is pressed.
   *
   * An inline handler attribute is registered as the element is parsed, which
   * is before this script runs at the end of the body. So
   * onclick="event.stopImmediatePropagation()" on the verify button silences
   * the listener below entirely: no presentation sweep, no attachment check,
   * no script count, no verdict — and the packet still holds exactly one
   * script element and an untouched stylesheet. A check that lives inside the
   * handler cannot catch what stops the handler running, so this one does not
   * live there.
   *
   * A sealed packet carries no event-handler attribute anywhere; the generator
   * emits none at all, which is what makes this a fact about the format rather
   * than a guess, and packetVerifierCsp fails if one is ever added.
   *
   * The button and the record are pinned unique for the same reason: getElementById
   * returns the first match, so a decoy placed ahead of either takes this
   * script's attention while the one the buyer uses does nothing.
   */
  var sawRefresh = false;

  function armingProblems() {
    var found = [];

    var handlers = 0;
    var all = [].slice.call(document.querySelectorAll('*'));
    for (var i = 0; i < all.length; i += 1) {
      var attrs = all[i].attributes;
      if (!attrs) continue;
      for (var a = 0; a < attrs.length; a += 1) {
        if (/^on/i.test(String(attrs[a].name || ''))) handlers += 1;
      }
    }
    if (handlers) {
      found.push(
        'This packet contains ' +
          handlers +
          ' inline event handler(s). A sealed packet contains none, so they were added after it was sealed — and one on the button above can stop this check running at all.',
      );
    }

    /*
     * A refresh directive does not wait to be clicked.
     *
     * meta http-equiv="refresh" content="0;url=..." sends the browser
     * somewhere else the moment it is parsed — before the buyer presses
     * Recompute, so no sweep below ever runs and no verdict is ever shown. It
     * is not an embedded resource and does not raise the script count, so the
     * other rules never saw it.
     *
     * A sealed packet emits exactly one meta element, the charset, and never
     * an http-equiv. Removing the node is best effort: the navigation is
     * scheduled when the element is parsed and does not reliably cancel. What
     * does work is the dialog, which blocks this thread — a pending refresh
     * cannot run while it is open, so the buyer is told before the page can
     * leave.
     */
    var refreshes = [].slice.call(document.querySelectorAll('meta[http-equiv]'));
    for (var m = 0; m < refreshes.length; m += 1) {
      var equiv = String(refreshes[m].getAttribute('http-equiv') || '').toLowerCase();
      if (equiv !== 'refresh') continue;
      /*
       * LATCHED, because removing the node hides the evidence from the next
       * sweep. Neutralizing and then reporting PASS on the click that follows
       * would be the worst outcome available here: the packet was altered, the
       * check found it, and then forgot.
       */
      sawRefresh = true;
      try {
        if (refreshes[m].parentNode) refreshes[m].parentNode.removeChild(refreshes[m]);
      } catch (error) {
        // Best effort only; the dialog below is what the buyer relies on.
      }
    }
    if (sawRefresh) {
      found.push(
        'This packet carries a refresh instruction that sends your browser somewhere else on its own. A sealed packet contains none, so it was added after sealing — do not follow wherever it was taking you.',
      );
    }

    /*
     * The control has to be OPERABLE, not merely present.
     *
     * The disabled attribute is native: no CSS, no script, no embedded
     * resource, and the button simply never fires. Every check that waits for
     * a click is then unreachable — the same shape as an inline handler that
     * silences the listener, and the reason both are answered here rather than
     * inside the handler they would prevent. A sealed packet emits the button
     * with a class, an id and a type, and nothing else.
     */
    if (btn.getAttribute('disabled') !== null) {
      found.push(
        'The button that runs this check has been disabled, so it cannot run. A sealed packet leaves it working, so this was done after sealing — do not trust anything shown here.',
      );
    }

    var ids = ['xbar-verify-btn', 'xbar-credential-payload'];
    for (var k = 0; k < ids.length; k += 1) {
      var named = document.querySelectorAll('#' + ids[k]);
      if (named.length !== 1) {
        found.push(
          'This packet contains ' +
            named.length +
            ' elements with the id ' +
            ids[k] +
            '. A sealed packet contains one, so this check may be reading a copy rather than what you are looking at.',
        );
      }
    }

    return found;
  }

  /*
   * The presentation sweep runs HERE too, not only on the click.
   *
   * An altered stylesheet can hide or disable the verify button, and a check
   * that waits to be clicked never runs on a packet nobody can click. So
   * everything that does not depend on layout is answered while the script
   * arms; the geometry is asked on the click, when the page has settled.
   */
  var arming = armingProblems().concat(presentationProblems(false));
  if (arming.length) {
    warnAloud(arming);
    show(
      'fail',
      'ALTERED. This packet was changed in a way that can stop this check running.' +
        NL + NL +
        arming.join(NL) +
        NL + NL +
        'Do not trust the button above or anything printed here. Use the by-hand steps below instead.',
    );
  }

  btn.addEventListener('click', function () {
    var presentation = armingProblems().concat(presentationProblems(true));
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
           * The one legitimate img is the sealed hero photo in the seller
           * contact block: the generator emits exactly
           * <img src="…" alt="…" width="100%">, where the src is the
           * payload's seller.heroPhotoUrl, the alt is the sealed horse name
           * (or 'Unnamed horse'), and the width is the literal '100%'. An
           * img that matches all three values and carries no other
           * attributes is the photo the seal covers, not an addition.
           * (For a data: URL the src IS the bytes, so an exact match proves
           * the photo content is untouched.) Anything else — a second copy,
           * a replaced src, an altered alt or width, an extra attribute, a
           * missing photo — is an alteration, because the generator emits
           * exactly one such img and only when the sealed record names a
           * hero photo.
           */
          var sealedPhoto =
            parsed && parsed.seller && typeof parsed.seller.heroPhotoUrl === 'string'
              ? parsed.seller.heroPhotoUrl
              : '';
          var sealedPhotoSeen = 0;
          var heroNode = null;
          var EMBEDS =
            'img,iframe,embed,object,video,audio,source,track,link,base,svg,frame,frameset,applet,portal,form';
          [].slice.call(document.querySelectorAll(EMBEDS)).forEach(function (node) {
            var tag = String(node.tagName || 'element').toLowerCase();
            var from =
              node.getAttribute('src') || node.getAttribute('href') || node.getAttribute('data') || '';
            /*
             * The generator emits the hero photo as exactly
             * <img src="…" alt="…" width="100%"> — the alt is the sealed
             * horse name (or 'Unnamed horse'), the width is the literal
             * '100%'. Checking only attribute NAMES lets
             * <img src="<sealed>" alt="different horse" width="0"> pass
             * while the buyer sees no photo and altered alt text. So the
             * exemption seals the complete expected element: exact src,
             * exact alt, exact width, and nothing else.
             */
            function isUnmodifiedHeroImg(node, parsed) {
              var attrs = node.attributes;
              if (!attrs || attrs.length !== 3) return false;
              var identity = parsed && parsed.identity ? parsed.identity : {};
              var expectedAlt = identity.name || 'Unnamed horse';
              var seen = {};
              for (var a = 0; a < attrs.length; a += 1) {
                seen[String(attrs[a].name || '').toLowerCase()] = attrs[a].value;
              }
              return seen.src === sealedPhoto && seen.alt === expectedAlt && seen.width === '100%';
            }
            if (tag === 'img' && sealedPhoto && from === sealedPhoto && isUnmodifiedHeroImg(node, parsed)) {
              sealedPhotoSeen += 1;
              if (!heroNode) heroNode = node;
              if (sealedPhotoSeen > 1) {
                problems.push(
                  'This packet shows the sealed hero photo more than once. The generator emits it exactly once, so the extra copy was added after sealing.',
                );
              }
              return;
            }
            problems.push(
              'This packet contains an added ' +
                tag +
                ' element' +
                (from ? ' loading "' + from + '"' : '') +
                ', which the seal does not cover. A sealed packet embeds nothing but its own attachments and its one sealed hero photo, so this was put here after it was sealed. Do not trust what it shows you.',
            );
          });
          if (sealedPhoto && sealedPhotoSeen === 0) {
            problems.push(
              'The hero photo the seal covers is missing from this packet. It was sealed as "' +
                sealedPhoto +
                '", so removing it is an alteration.',
            );
          }

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

          /*
           * The seller contact block, against the one in the record.
           *
           * The watermark reasoning, with more at stake. The contact block is
           * where a buyer learns whom to write to and pay, nothing else on the
           * page vouches for it, and it is the fact a fraudster most wants to
           * change: a packet altered to show their own email left the payload
           * untouched, so the digest matched and this check said PASS while
           * the buyer wrote to them.
           *
           * Found by walking the table the seal put there, never by id alone.
           * An id is ordinary HTML an alterer controls: strip it from the
           * visible cell, show another address there, and park a marked copy
           * of the sealed one out of sight in the collapsed by-hand section,
           * and a lookup by id finds exactly one node with the sealed text. So
           * every piece is pinned to what the generator emits, the way the
           * hero photo is: one table, in its own section under the content,
           * with exactly one row per sealed field in sealed order, each row a
           * plain label cell and one value cell carrying nothing but its name.
           * Pinning every attribute is what keeps them visible: hidden, a
           * concealing class, or a move into the collapsed section all change
           * one, and anything hiding the content above them hides the verdict
           * box too, which the presentation sweep already refuses. A row added
           * beside them (Wire to: …) is unsealed text dressed as sealed.
           */
          function exactly(node, tag, attrs) {
            if (!node || String(node.tagName || '').toUpperCase() !== tag) return false;
            var names = Object.keys(attrs);
            var list = node.attributes || [];
            if (list.length !== names.length) return false;
            for (var n = 0; n < names.length; n += 1) {
              if (node.getAttribute(names[n]) !== attrs[names[n]]) return false;
            }
            return true;
          }
          function textOf(node) {
            return node ? (node.textContent || '').trim() : '';
          }
          /*
           * A leaf carries its text and nothing else. textContent reads a
           * hidden child as readily as a visible one, so a cell holding a
           * visible input over a hidden copy of the sealed text would compare
           * equal while showing the buyer the input. The generator puts no
           * element inside any of these, so any child at all is an alteration.
           */
          function leaf(node, tag, attrs) {
            return exactly(node, tag, attrs) && !!node.children && node.children.length === 0;
          }
          /*
           * Every count and placement check here reads elements. A bare line
           * of text typed between them (UPDATED PAYMENT EMAIL: …) is a text
           * node: no element count sees it, and the page shows it all the
           * same. The generator writes no text directly into any container
           * pinned here, only whitespace at most, so any other text node in
           * one is an alteration, and it is quoted back so the buyer sees what
           * was added.
           */
          function refuseLooseText(node, where) {
            var nodes = node && node.childNodes ? node.childNodes : [];
            for (var t = 0; t < nodes.length; t += 1) {
              var loose = nodes[t].nodeType === 3 ? String(nodes[t].nodeValue || '').trim() : '';
              if (loose) {
                problems.push('Text was added ' + where + ' after it was sealed: "' + loose + '". The seal does not cover it. Do not act on it.');
                return;
              }
            }
          }
          /*
           * The content block is the one the verdict box sits in, already
           * pinned by SEALED_OUT_CHAIN — not any element that merely carries
           * its class. A second content block built inside the collapsed
           * section could otherwise host the sealed contact out of sight.
           */
          var sealedContent =
            out.parentElement && out.parentElement.parentElement ? out.parentElement.parentElement.parentElement : null;
          var sealedSeller = parsed && parsed.seller && typeof parsed.seller === 'object' ? parsed.seller : null;
          if (sealedSeller) {
            var wanted = [
              ['name', 'Seller', 'seller name'],
              ['ranch', 'Ranch', 'ranch'],
              ['email', 'Email', 'seller email'],
            ].filter(function (field) {
              return typeof sealedSeller[field[0]] === 'string' && sealedSeller[field[0]] !== '';
            });
            /*
             * The content holds exactly what the generator emits: its header,
             * seven sections, the seal, the footer, and the seller section when
             * the seal carries a contact or a photo. Anything added at the top
             * level (a replacement header with its own Prepared by, a second
             * contact block) is text the seal never covered.
             */
            var CONTENT_ITEMS = 10;
            var topItems = sealedContent && sealedContent.children ? sealedContent.children.length : -1;
            var expectedTop = CONTENT_ITEMS + (sealedPhoto || wanted.length ? 1 : 0);
            if (topItems !== expectedTop) {
              problems.push(
                'This packet has ' + topItems + ' top-level part(s), and the seal put ' + expectedTop + ' there, so something was added to the page or taken from it after it was sealed.',
              );
            }
            refuseLooseText(sealedContent, 'between the sections of this packet');
            var tables = document.querySelectorAll('#xbar-seller-contact');
            var table = tables.length === 1 ? tables[0] : null;
            var section = table ? table.parentElement : null;
            if (tables.length !== (wanted.length ? 1 : 0)) {
              problems.push(
                'This packet shows ' + tables.length + ' seller contact table(s), and the seal covers ' + (wanted.length ? 'one' : 'none') + '. Do not use the contact details shown.',
              );
            } else if (
              table &&
              (!exactly(table, 'TABLE', { id: 'xbar-seller-contact' }) ||
                !table.children ||
                table.children.length !== 1 ||
                !exactly(table.children[0], 'TBODY', {}) ||
                !exactly(section, 'SECTION', {}) ||
                section.parentElement !== sealedContent)
            ) {
              problems.push(
                'The seller contact table on this packet is not where the seal put it, or is not shown as it was sealed, so the contact details on it cannot be trusted.',
              );
            }
            /*
             * The contact section holds its heading, then the sealed hero photo
             * when there is one, then the contact table when there is one, and
             * nothing else, each item in its sealed place. The photo is pinned
             * to this section as an element, not by a count: moved into the
             * collapsed by-hand section, it still passes the photo sweep, and a
             * forged note (an updated payment address) in its slot keeps the
             * count. The section is found from the photo when the seal carries
             * one, so a photo-only section is held to the same rule.
             */
            var contactSection = sealedPhoto && heroNode ? heroNode.parentElement : section;
            if (contactSection && (sealedPhoto || wanted.length)) {
              var expectedItems = [null];
              if (sealedPhoto) expectedItems.push(heroNode);
              if (wanted.length) expectedItems.push(table);
              var sectionItems = contactSection.children || [];
              var sectionHolds =
                exactly(contactSection, 'SECTION', {}) &&
                contactSection.parentElement === sealedContent &&
                sectionItems.length === expectedItems.length &&
                leaf(sectionItems[0], 'H2', {});
              for (var item = 1; sectionHolds && item < expectedItems.length; item += 1) {
                sectionHolds = sectionItems[item] === expectedItems[item];
              }
              if (!sectionHolds) {
                problems.push(
                  'The seller contact section on this packet holds ' + sectionItems.length + ' item(s), and the seal put ' + expectedItems.length + ' there in a fixed order, so something in it was moved or was not sealed.',
                );
              } else if (textOf(sectionItems[0]) !== 'Contact the seller') {
                problems.push(
                  'The seller contact section on this packet is headed "' + textOf(sectionItems[0]) + '" where it was sealed as "Contact the seller". Do not act on it.',
                );
              }
              refuseLooseText(contactSection, 'to the seller contact section of this packet');
            }
            if (table) {
              refuseLooseText(table, 'to the seller contact table of this packet');
              refuseLooseText(table.children && table.children[0], 'to the seller contact table of this packet');
            }
            var contactRows = document.querySelectorAll('#xbar-seller-contact tr');
            if (contactRows.length !== wanted.length) {
              problems.push(
                'The seller contact table on this packet has ' + contactRows.length + ' row(s), and the seal covers ' + wanted.length + ', so at least one was removed or was never sealed. Do not use the contact details shown.',
              );
            } else {
              for (var r = 0; r < contactRows.length; r += 1) {
                var field = wanted[r];
                var want = sealedSeller[field[0]];
                var row = contactRows[r];
                var cells = row.children || [];
                refuseLooseText(row, 'to the seller contact table of this packet');
                var holder = row.parentElement;
                if (holder && String(holder.tagName || '').toUpperCase() === 'TBODY') {
                  holder = exactly(holder, 'TBODY', {}) ? holder.parentElement : null;
                }
                var inPlace =
                  holder === table &&
                  exactly(row, 'TR', {}) &&
                  cells.length === 2 &&
                  leaf(cells[0], 'TH', {}) &&
                  textOf(cells[0]) === field[1] &&
                  leaf(cells[1], 'TD', { id: 'xbar-seller-' + field[0] });
                if (!inPlace) {
                  problems.push(
                    'The ' + field[2] + ' row on this packet is not the one the seal put there. It was sealed as "' + want + '". Do not use the one shown.',
                  );
                } else if (textOf(cells[1]) !== want) {
                  problems.push(
                    'This packet shows the ' + field[2] + ' as "' + textOf(cells[1]) + '" but it was sealed as "' + want + '". Do not use the one shown.',
                  );
                }
              }
            }
          }
          /*
           * The Prepared by line names the seller too, and is pinned the same
           * way: one named span, as the second and last item of the header's
           * meta line, carrying nothing but its text; the meta line the last of
           * the header's three items; the header a direct child of the sealed
           * content. So the whole header cannot be moved out of sight behind a
           * forged one. With no byline sealed, the meta line holds its
           * Generated stamp alone, so an unmarked Prepared by added there is
           * caught too.
           */
          if (parsed && typeof parsed.sealedBy === 'string') {
            var wantByline = parsed.sealedBy ? 'Prepared by ' + parsed.sealedBy : '';
            var metas = document.querySelectorAll('#xbar-packet-meta');
            var metaLine = metas.length === 1 ? metas[0] : null;
            var metaItems = metaLine && metaLine.children ? metaLine.children : [];
            var byline = wantByline && metaItems.length === 2 ? metaItems[1] : null;
            var head = metaLine ? metaLine.parentElement : null;
            var bylinePlaced =
              exactly(metaLine, 'DIV', { class: 'meta', id: 'xbar-packet-meta' }) &&
              exactly(head, 'HEADER', {}) &&
              head.parentElement === sealedContent &&
              !!head.children &&
              head.children.length === 3 &&
              head.children[2] === metaLine &&
              metaItems.length === (wantByline ? 2 : 1) &&
              leaf(metaItems[0], 'SPAN', {}) &&
              document.querySelectorAll('#xbar-seller-byline').length === (wantByline ? 1 : 0) &&
              (!wantByline || leaf(byline, 'SPAN', { id: 'xbar-seller-byline' }));
            if (!bylinePlaced) {
              problems.push(
                'The Prepared by line on this packet is not where the seal put it, or is hidden, or was added. It was sealed as "' + (wantByline || 'no Prepared by line') + '".',
              );
            } else if (wantByline && textOf(byline) !== wantByline) {
              problems.push('This packet says "' + textOf(byline) + '" but was sealed as "' + wantByline + '".');
            }
            if (metaLine) {
              refuseLooseText(head, 'to the header of this packet');
              refuseLooseText(metaLine, 'to the header of this packet');
            }
          }

          /*
           * The stamp beside the byline is sealed too: it prints the date the
           * record carries as sealedAt. Left as free text, it could be
           * rewritten to show a forged contact (Prepared by …) next to the
           * genuine byline, with every count and placement unchanged.
           */
          if (parsed && typeof parsed.sealedAt === 'string') {
            var stampLines = document.querySelectorAll('#xbar-packet-meta');
            var stampSpan = stampLines.length === 1 && stampLines[0].children ? stampLines[0].children[0] : null;
            var wantStamp = 'Generated ' + parsed.sealedAt.slice(0, 10);
            if (!leaf(stampSpan, 'SPAN', {}) || textOf(stampSpan) !== wantStamp) {
              problems.push(
                'The header of this packet says "' + textOf(stampSpan) + '" where it was sealed as "' + wantStamp + '". The page was edited after it was sealed.',
              );
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
