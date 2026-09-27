(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var vervoer = 'scooter';
  var voorbeeldTimer;

  function badge(status, label) {
    return '<span class="badge b-' + esc(String(status).replace(/\s+/g, '-')) + '">' + esc(label || status) + '</span>';
  }

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- API en sessie ----------
  var SESSIE_SLEUTEL = 'pf_beheer_sessie';

  function leesSessie() {
    try {
      var s = JSON.parse(localStorage.getItem(SESSIE_SLEUTEL) || 'null');
      return s && s.sessie && s.verloopt > Date.now() ? s : null;
    } catch (e) {
      return null;
    }
  }
  function bewaarSessie(s) {
    try { localStorage.setItem(SESSIE_SLEUTEL, JSON.stringify(s)); } catch (e) { /* privévenster: alleen deze sessie */ }
    sessieInGeheugen = s;
  }
  function wisSessie() {
    try { localStorage.removeItem(SESSIE_SLEUTEL); } catch (e) { /* niets */ }
    sessieInGeheugen = null;
  }
  var sessieInGeheugen = leesSessie();

  /** POST naar de Apps Script-API zonder cookies (werkt ook met meerdere Google-accounts). */
  function api(verzoek) {
    return fetch(window.PF_CONFIG.api, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(verzoek)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      try { return JSON.parse(t); } catch (e) { throw new Error('Geen geldig antwoord van de server. Probeer het opnieuw.'); }
    });
  }

  /** Zelfde vorm als vroeger google.script.run: roep(functie, args, ok, fout). */
  function roep(fn, args, ok, fout) {
    var s = sessieInGeheugen;
    if (!s) { toonLogin(); return; }
    api({ actie: 'beheer', sessie: s.sessie, functie: fn, args: args || [] }).then(function (r) {
      if (r.status === 'uitgelogd') { wisSessie(); toonLogin('Je sessie is verlopen of ingetrokken. Log opnieuw in.'); return; }
      if (r.status !== 'ok') throw new Error(r.melding || 'Er ging iets mis.');
      ok(r.data);
    }).catch(function (e) {
      toon((e && e.message) || 'Er ging iets mis.', true);
      if (fout) fout(e);
    });
  }

  // ---------- Inloggen ----------
  function toonLogin(melding) {
    $('app').hidden = true;
    $('detail').classList.remove('open');
    $('login').hidden = false;
    $('loginEmail').hidden = false;
    $('loginCode').hidden = true;
    $('l-email-fout').textContent = melding || '';
    $('l-email').focus();
  }

  function toonApp() {
    $('login').hidden = true;
    $('app').hidden = false;
    $('gebruiker').textContent = sessieInGeheugen.email;
    laad();
  }

  $('loginEmail').addEventListener('submit', function (e) {
    e.preventDefault();
    var knop = $('l-stuur');
    var email = $('l-email').value.trim();
    $('l-email-fout').textContent = '';
    knop.disabled = true;
    api({ actie: 'login_vraag', email: email }).then(function (r) {
      knop.disabled = false;
      if (r.status === 'fouten') { $('l-email-fout').textContent = r.fouten.email; return; }
      $('loginEmail').hidden = true;
      $('loginCode').hidden = false;
      $('l-uitleg').textContent = 'Als ' + email + ' toegang heeft, is er nu een code naartoe gestuurd. ' +
        'De code is 10 minuten geldig. Kijk ook even in je spam.';
      $('l-code').value = '';
      $('l-code').focus();
    }).catch(function (err) { knop.disabled = false; $('l-email-fout').textContent = err.message; });
  });

  $('loginCode').addEventListener('submit', function (e) {
    e.preventDefault();
    var knop = $('l-inloggen');
    $('l-code-fout').textContent = '';
    knop.disabled = true;
    api({ actie: 'login_code', email: $('l-email').value.trim(), code: $('l-code').value, apparaat: navigator.userAgent })
      .then(function (r) {
        knop.disabled = false;
        if (r.status !== 'ok') { $('l-code-fout').textContent = (r.fouten && r.fouten.code) || 'Inloggen lukte niet.'; return; }
        bewaarSessie({ sessie: r.sessie, email: r.email, verloopt: r.verloopt });
        toonApp();
      }).catch(function (err) { knop.disabled = false; $('l-code-fout').textContent = err.message; });
  });

  $('l-opnieuw').addEventListener('click', function () { toonLogin(); });

  $('uitloggen').addEventListener('click', function () {
    var s = sessieInGeheugen;
    wisSessie();
    if (s) api({ actie: 'uitloggen', sessie: s.sessie }).catch(function () { /* lokaal al uitgelogd */ });
    toonLogin('Je bent uitgelogd.');
  });

  // ---------- PDF's (via de API, geen Drive-toegang nodig) ----------
  function pdfKnop(soort, tekst) {
    return '<div data-pdf="' + soort + '"><button class="knop licht" data-actie="pdf" data-soort="' + soort + '">' +
      esc(tekst) + '</button></div>';
  }

  function base64NaarBlob(b64, type) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type });
  }

  var meldingTimer;
  function toon(tekst, isFout) {
    var el = $('melding');
    el.textContent = tekst;
    el.className = 'toon' + (isFout ? ' fout' : '');
    clearTimeout(meldingTimer);
    meldingTimer = setTimeout(function () { el.className = isFout ? 'fout' : ''; }, isFout ? 7000 : 3500);
  }

  // yyyy-mm-dd (date input) → dd-mm-jjjj
  function naarNl(iso) {
    var p = String(iso || '').split('-');
    return p.length === 3 ? p[2] + '-' + p[1] + '-' + p[0] : '';
  }

  function eersteVanDezeMaand() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01';
  }

  // ---------- Lijst ----------
  function laad() {
    roep('overzicht', [], function (o) {
      var actief = o.medewerkers.filter(function (m) { return m.status !== 'Geannuleerd'; }).length;
      $('telling').textContent = actief === 1 ? '1 medewerker in de flow' : actief + ' medewerkers in de flow';
      $('testbalk').hidden = !o.testmodus;
      $('testbalk').textContent = 'Testmodus: alle mails gaan naar ' + o.testEmail + '.';
      if (!o.medewerkers.length) {
        $('lijst').innerHTML = '<div class="leeg">Nog niemand. Tik op Nieuwe medewerker om te beginnen.</div>';
        return;
      }
      $('lijst').innerHTML = o.medewerkers.map(function (m) {
        return '<button class="item' + (m.status === 'Geannuleerd' ? ' uit' : '') + '" data-id="' + esc(m.id) + '">' +
          '<div class="wie"><div class="naam">' + esc(m.naam) + '</div>' +
          '<div class="wanneer">Start ' + esc(m.startdatum) + '</div>' +
          (m.waarschuwingen ? '<div class="let">⚠ ' + esc(m.waarschuwingen) + '</div>' : '') + '</div>' +
          badge(m.status, m.statusLabel) + '</button>';
      }).join('');
    });
  }

  $('lijst').addEventListener('click', function (e) {
    var item = e.target.closest('.item');
    if (item) openDetail(item.dataset.id);
  });

  // ---------- Formulier ----------
  function resetFormulier() {
    ['f-naam', 'f-leeftijd', 'f-email'].forEach(function (id) { $(id).value = ''; });
    $('f-start').value = eersteVanDezeMaand();
    zetVervoer('scooter');
    toonFouten({});
    $('voorbeeld').hidden = true;
    $('v-fout').textContent = '';
  }

  function zetVervoer(w) {
    vervoer = w;
    Array.prototype.forEach.call($('f-vervoer').children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.waarde === w));
    });
  }

  function toonFouten(fouten) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-fout]'), function (el) {
      el.textContent = fouten[el.dataset.fout] || '';
    });
  }

  $('nieuwKnop').addEventListener('click', function () {
    resetFormulier();
    $('formulier').hidden = false;
    $('nieuwKnop').hidden = true;
    $('f-naam').focus();
  });

  $('annuleerForm').addEventListener('click', function () {
    $('formulier').hidden = true;
    $('nieuwKnop').hidden = false;
  });

  $('f-vervoer').addEventListener('click', function (e) {
    if (e.target.dataset.waarde) zetVervoer(e.target.dataset.waarde);
  });

  function vraagVoorbeeld() {
    clearTimeout(voorbeeldTimer);
    voorbeeldTimer = setTimeout(function () {
      var leeftijd = $('f-leeftijd').value, start = naarNl($('f-start').value);
      if (!leeftijd || !start) { $('voorbeeld').hidden = true; return; }
      roep('voorbeeld', [Number(leeftijd), start], function (v) {
        // Negeer een verouderd antwoord als de invoer intussen is gewijzigd.
        if (String(leeftijd) !== $('f-leeftijd').value || start !== naarNl($('f-start').value)) return;
        $('v-fout').textContent = v.fout || '';
        $('voorbeeld').hidden = !v.basis;
        if (!v.basis) return;
        $('v-basis').textContent = '€ ' + v.basis;
        $('v-allin').textContent = '€ ' + v.allin;
        $('v-sides').textContent = '€ ' + v.sides;
        $('v-extra').textContent = v.tabel + ' · contract t/m ' + v.einddatum + ' · proeftijd t/m ' + v.proeftijd;
      });
    }, 300);
  }
  $('f-leeftijd').addEventListener('input', vraagVoorbeeld);
  $('f-start').addEventListener('change', vraagVoorbeeld);

  $('formulier').addEventListener('submit', function (e) {
    e.preventDefault();
    var knop = $('startKnop');
    knop.disabled = true;
    knop.textContent = 'Bezig…';
    var invoer = {
      naam: $('f-naam').value,
      leeftijd: Number($('f-leeftijd').value),
      email: $('f-email').value,
      vervoermiddel: vervoer,
      startdatum: naarNl($('f-start').value)
    };
    roep('start', [invoer], function (r) {
      knop.disabled = false;
      knop.textContent = 'Start';
      if (!r.ok) {
        toonFouten(r.fouten || {});
        var eerste = { naam: 'f-naam', leeftijd: 'f-leeftijd', email: 'f-email', startdatum: 'f-start' }[Object.keys(r.fouten || {})[0]];
        if (eerste) $(eerste).focus();
        return;
      }
      $('formulier').hidden = true;
      $('nieuwKnop').hidden = false;
      if (r.mailFout) toon(r.mailFout, true);
      else toon(r.medewerker.naam + ' is uitgenodigd.');
      laad();
    }, function () {
      knop.disabled = false;
      knop.textContent = 'Start';
    });
  });

  // ---------- Detail ----------
  function lijstHtml(rijen) {
    return '<dl>' + rijen.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
    }).join('') + '</dl>';
  }

  function openDetail(id) {
    $('detailInhoud').innerHTML = '<button class="terug" data-actie="terug">‹ Terug</button><p class="klein">Laden…</p>';
    $('detail').classList.add('open');
    $('detail').setAttribute('aria-hidden', 'false');
    roep('detail', [id], toonDetail);
  }

  function sluitDetail() {
    $('detail').classList.remove('open');
    $('detail').setAttribute('aria-hidden', 'true');
    laad();
  }

  function controleHtml(c) {
    return '<div class="controle"><h2>Controle nodig: welke leeftijd klopt?</h2>' +
      '<p>Opgegeven bij de start: <strong>' + c.opgegeven + '</strong>. Volgens de geboortedatum (' + esc(c.geboortedatum) +
      ') op de startdatum: <strong>' + c.berekend + '</strong>. Vergelijk met de ID-foto hieronder. ' +
      'De bedragen worden pas na je keuze definitief.</p>' +
      '<div class="keuzes">' +
      '<button class="knop licht" data-actie="leeftijd-opgegeven">' + c.opgegeven + ' klopt</button>' +
      '<button class="knop" data-actie="leeftijd-berekend" data-leeftijd="' + c.berekend + '">' + c.berekend + ' klopt</button></div>' +
      '<div class="datumvak" id="datumvak" hidden>' +
      '<label for="juisteGeboortedatum">Juiste geboortedatum (past bij ' + c.opgegeven + ' jaar)</label>' +
      '<input id="juisteGeboortedatum" type="date">' +
      '<div class="fout" id="datumFout"></div>' +
      '<button class="knop mt10" data-actie="leeftijd-opgegeven-bevestig">Opslaan: ' + c.opgegeven + ' klopt</button>' +
      '</div></div>';
  }

  function vergelijkHtml(v) {
    return '<div class="vergelijk"><div><div class="klein">Geboortedatum</div>' +
      '<div class="groot">' + esc(v.geboortedatum) + '</div>' +
      '<div class="klein">' + v.leeftijdOpStart + ' jaar op de startdatum</div></div>' +
      '<div class="miniaturen">' + v.fotos.map(function (f) {
        return '<button data-actie="foto" data-naam="' + esc(f.naam) + '" aria-label="' + esc(f.naam) + ' groot bekijken">' +
          '<img src="' + esc(f.src) + '" alt=""></button>';
      }).join('') + '</div></div>';
  }

  function toonDetail(d) {
    var acties = '';
    if (d.kanOpnieuwUitnodigen) acties += '<button class="knop licht" data-actie="opnieuw">Uitnodiging opnieuw sturen</button>';
    if (d.loonheffingUrl) acties += pdfKnop('loonheffing', 'Loonheffingsverklaring');
    else if (d.loonheffingBezig) acties += '<div class="klein midden">Loonheffingsverklaring wordt gemaakt (binnen 5 minuten).</div>';
    if (d.heeftContract) acties += pdfKnop('contract', d.contractGetekend ? 'Contract (getekend)' : 'Contract (nog niet getekend)');
    if (d.mapUrl) acties += '<a class="knop licht link" target="_blank" rel="noopener" href="' + esc(d.mapUrl) + '">Drive-map openen</a>';
    if (d.kanAnnuleren) acties += '<button class="knop gevaar" data-actie="annuleer">Annuleren</button>';

    $('detailInhoud').innerHTML =
      '<button class="terug" data-actie="terug">‹ Terug</button>' +
      '<div class="kop-detail"><h1>' + esc(d.naam) + '</h1>' + badge(d.status, d.statusLabel) + '</div>' +
      (d.controle ? controleHtml(d.controle) : '') +
      (d.waarschuwingen && !d.controle ? '<div class="test mt12">⚠ ' + esc(d.waarschuwingen) + '</div>' : '') +
      (d.formulier.length ? '<div class="kaart"><h2>Formulier</h2>' + (d.vergelijk ? vergelijkHtml(d.vergelijk) : '') +
        lijstHtml(d.formulier) + '</div>' : '') +
      '<div class="kaart"><h2>Gegevens</h2>' + lijstHtml(d.gegevens) + '</div>' +
      '<div class="kaart"><h2>Loon' + (d.loonVoorlopig ? ' (voorlopig, op opgegeven leeftijd)' : '') + '</h2>' + lijstHtml(d.loon) + '</div>' +
      '<div class="kaart"><h2>Verloop</h2>' + lijstHtml(d.tijdlijn) + '</div>' +
      (acties ? '<div class="acties">' + acties + '</div>' : '');
    $('detailInhoud').dataset.id = d.id;
  }

  /** Eigen bevestigingsvenster (i.p.v. confirm(), dat een melding van googleusercontent.com toont). Geeft een Promise<boolean>. */
  function bevestig(titel, tekst, jaTekst, gevaar, neeTekst) {
    return new Promise(function (klaar) {
      var vorigeFocus = document.activeElement;
      var achter = document.createElement('div');
      achter.className = 'dialoog-achter';
      achter.innerHTML = '<div class="dialoog" role="alertdialog" aria-modal="true" aria-labelledby="dlgTitel" aria-describedby="dlgTekst">' +
        '<h2 id="dlgTitel"></h2><p id="dlgTekst"></p><div class="dialoog-knoppen">' +
        '<button class="knop licht" data-keuze="nee"></button><button class="knop" data-keuze="ja"></button></div></div>';
      achter.querySelector('#dlgTitel').textContent = titel;
      achter.querySelector('#dlgTekst').textContent = tekst;
      achter.querySelector('[data-keuze="nee"]').textContent = neeTekst || 'Terug';
      var ja = achter.querySelector('[data-keuze="ja"]');
      ja.textContent = jaTekst;
      if (gevaar) ja.classList.add('rood');
      function sluit(uitkomst) {
        document.removeEventListener('keydown', toets);
        achter.remove();
        if (vorigeFocus && vorigeFocus.focus) vorigeFocus.focus();
        klaar(uitkomst);
      }
      function toets(e) { if (e.key === 'Escape') sluit(false); }
      achter.addEventListener('click', function (e) {
        if (e.target === achter) return sluit(false);
        var k = e.target.closest('[data-keuze]');
        if (k) sluit(k.dataset.keuze === 'ja');
      });
      document.addEventListener('keydown', toets);
      document.body.appendChild(achter);
      achter.querySelector('[data-keuze="nee"]').focus();
    });
  }

  function toonFoto(src) {
    var lb = document.createElement('div');
    lb.id = 'lightbox';
    lb.innerHTML = '<img alt="ID-foto">';
    lb.firstChild.src = src;
    lb.addEventListener('click', function () { lb.remove(); });
    document.body.appendChild(lb);
  }

  $('detailInhoud').addEventListener('click', function (e) {
    var el = e.target.closest('[data-actie]');
    if (!el) return;
    var id = $('detailInhoud').dataset.id;
    var actie = el.dataset.actie;
    if (actie === 'terug') return sluitDetail();
    if (actie === 'pdf') {
      var vak = el.parentNode;
      var label = el.textContent;
      el.disabled = true;
      el.textContent = 'Laden…';
      roep('bestand', [id, el.dataset.soort], function (b) {
        // Na het laden twee echte links: die openen ook in Safari zonder pop-upblokkering.
        var url = URL.createObjectURL(base64NaarBlob(b.base64, b.type));
        vak.className = 'pdf-knoppen';
        vak.innerHTML = '<a class="knop licht link" target="_blank" rel="noopener"></a><a class="knop licht link"></a>';
        vak.children[0].href = url;
        vak.children[0].textContent = 'Openen: ' + label;
        vak.children[1].href = url;
        vak.children[1].download = b.naam;
        vak.children[1].textContent = 'Downloaden';
      }, function () { el.disabled = false; el.textContent = label; });
      return;
    }
    if (actie === 'foto') {
      toonFoto(el.querySelector('img').src); // eerst de miniatuur, dan scherp
      roep('fotoGroot', [id, el.dataset.naam], function (src) {
        var img = document.querySelector('#lightbox img');
        if (img) img.src = src;
      });
      return;
    }
    if (actie === 'leeftijd-berekend') {
      bevestig('Leeftijd ' + el.dataset.leeftijd + ' vastleggen?',
        'De bedragen worden definitief op ' + el.dataset.leeftijd + ' jaar gezet. Daarna wordt het contract gemaakt en gemaild.',
        el.dataset.leeftijd + ' klopt').then(function (ja) {
        if (!ja) return;
        el.disabled = true;
        roep('leeftijdKlopt', [id, 'berekend', ''], function (d) { toonDetail(d); toon('Leeftijd bevestigd, bedragen vastgelegd.'); },
          function () { el.disabled = false; });
      });
      return;
    }
    if (actie === 'leeftijd-opgegeven') {
      $('datumvak').hidden = false;
      $('juisteGeboortedatum').focus();
      return;
    }
    if (actie === 'leeftijd-opgegeven-bevestig') {
      var geb = naarNl($('juisteGeboortedatum').value);
      if (!geb) { $('datumFout').textContent = 'Vul de juiste geboortedatum in.'; return; }
      el.disabled = true;
      roep('leeftijdKlopt', [id, 'opgegeven', geb], function (d) {
        toonDetail(d); toon('Leeftijd en geboortedatum opgeslagen. Loonheffingsverklaring wordt opnieuw gemaakt.');
      }, function (e) { el.disabled = false; $('datumFout').textContent = (e && e.message) || ''; });
      return;
    }
    if (actie === 'opnieuw') {
      el.disabled = true;
      roep('opnieuwUitnodigen', [id], function (d) { toonDetail(d); toon('Uitnodiging opnieuw verstuurd.'); },
        function () { el.disabled = false; });
    }
    if (actie === 'annuleer') {
      bevestig('Aanmelding annuleren?', 'De links in de mails werken daarna niet meer. Dit kun je niet ongedaan maken.',
        'Annuleren', true, 'Niet annuleren').then(function (ja) {
        if (!ja) return;
        el.disabled = true;
        roep('annuleren', [id], function (d) { toonDetail(d); toon('Geannuleerd.'); }, function () { el.disabled = false; });
      });
    }
  });

  if (sessieInGeheugen) toonApp();
  else toonLogin();
})();
