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
  var STORING = 'De server van Google reageert even niet. Probeer het zo opnieuw.';

  /** Technische fout (netwerk, foutpagina van Google): nette Nederlandse melding, en herkenbaar voor opnieuw proberen. */
  function storing() {
    var e = new Error(STORING);
    e.technisch = true;
    return e;
  }

  function api(verzoek) {
    return fetch(window.PF_CONFIG.api, {
      method: 'POST',
      credentials: 'omit',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(verzoek)
    }).then(function (r) {
      // Google geeft af en toe een 404-foutpagina ("Kan het bestand niet openen") i.p.v. ons antwoord.
      if (!r.ok) throw storing();
      return r.text();
    }, function () {
      throw storing();
    }).then(function (t) {
      try { return JSON.parse(t); } catch (e) { throw storing(); }
    });
  }

  /** Zelfde vorm als vroeger google.script.run: roep(functie, args, ok, fout). */
  /**
   * Alleen-lezen: komt er na 6 s geen antwoord, dan gaat er een tweede, identieke aanroep; de eerste wint.
   * Vangt de uitschieters van Google Apps Script op. Acties die iets veranderen worden nooit dubbel verstuurd.
   */
  var ALLEEN_LEZEN = ['overzicht', 'detail', 'miniaturen', 'voorbeeld', 'bestand', 'fotoGroot'];
  // Achtergrondaanroepen: mislukken mag nooit een rode balk geven (de gegevens staan al op het scherm).
  var ACHTERGROND = ['miniaturen', 'voorbeeld'];

  var MAX_POGINGEN = 3;

  /**
   * Veilig te herhalen aanroepen: na `dubbelNa` ms zonder antwoord een extra poging, en na een foutpagina van Google
   * direct opnieuw (maximaal 3 pogingen). De eerste die antwoordt wint; na `max` ms: storing.
   */
  function apiSnel(verzoek, dubbelNa, max) {
    return new Promise(function (ok, fout) {
      var klaar = false, gestart = 0, mislukt = 0;
      function poging() {
        gestart++;
        api(verzoek).then(function (r) {
          if (klaar) return;
          klaar = true; clearTimeout(t1); clearTimeout(t2); ok(r);
        }, function (e) {
          mislukt++;
          if (klaar) return;
          if (gestart < MAX_POGINGEN) { setTimeout(function () { if (!klaar) poging(); }, 400); return; }
          if (mislukt >= gestart) { klaar = true; clearTimeout(t2); fout(e); }
        });
      }
      var t1 = setTimeout(function () { if (!klaar && gestart < MAX_POGINGEN) poging(); }, dubbelNa);
      var t2 = setTimeout(function () { if (!klaar) { klaar = true; fout(storing()); } }, max);
      poging();
    });
  }

  /** stil: geen foutmelding tonen (voor automatisch verversen op de achtergrond). */
  function roep(fn, args, ok, fout, stil) {
    var s = sessieInGeheugen;
    if (!s) { toonLogin(); return; }
    var verzoek = { actie: 'beheer', sessie: s.sessie, functie: fn, args: args || [] };
    stil = stil || ACHTERGROND.indexOf(fn) !== -1;
    (ALLEEN_LEZEN.indexOf(fn) !== -1 ? apiSnel(verzoek, 6000, 45000) : api(verzoek)).then(function (r) {
      if (r.status === 'uitgelogd') { wisSessie(); toonLogin('Je sessie is verlopen of ingetrokken. Log opnieuw in.'); return; }
      if (r.status !== 'ok') throw new Error(r.melding || 'Er ging iets mis.');
      ok(r.data);
      if (r.melding) toon(r.melding); // bijv. "Al gedaan door …": actuele status staat er al
    }).catch(function (e) {
      if (!stil) toon((e && e.message) || 'Er ging iets mis.', true);
      if (fout) fout(e);
    });
  }

  /** Knop meteen op "Bezig…" met spinner; geeft een functie terug die de knop herstelt. */
  function bezig(knop, tekst) {
    var oud = knop.innerHTML;
    knop.disabled = true;
    knop.classList.add('bezig');
    knop.textContent = tekst || 'Bezig…';
    return function () {
      knop.disabled = false;
      knop.classList.remove('bezig');
      knop.innerHTML = oud;
    };
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

  var EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  $('loginEmail').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('l-email').value.trim();
    $('l-email-fout').textContent = '';
    if (!EMAIL_OK.test(email)) { $('l-email-fout').textContent = 'Vul een geldig e-mailadres in.'; return; }
    // Meteen naar het codescherm; de code wordt op de achtergrond verstuurd.
    $('loginEmail').hidden = true;
    $('loginCode').hidden = false;
    $('l-uitleg').textContent = 'Als ' + email + ' toegang heeft, komt er nu een code naartoe. ' +
      'De code is 10 minuten geldig. Kijk ook even in je spam.';
    $('l-code').value = '';
    $('l-code-fout').textContent = '';
    $('l-code').focus();
    api({ actie: 'login_vraag', email: email }).then(function (r) {
      if (r.status === 'fouten') { toonLogin(r.fouten.email); return; }
      if (r.status !== 'verstuurd') throw new Error();
    }).catch(function () {
      toonLogin('Versturen van de code lukte niet. Controleer je internet en probeer het opnieuw.');
    });
  });

  $('loginCode').addEventListener('submit', function (e) {
    e.preventDefault();
    $('l-code-fout').textContent = '';
    var herstel = bezig($('l-inloggen'), 'Bezig met inloggen…');
    // Mag veilig herhaald worden: de server geeft bij hetzelfde verzoek binnen 2 minuten dezelfde sessie terug.
    apiSnel({ actie: 'login_code', email: $('l-email').value.trim(), code: $('l-code').value, apparaat: navigator.userAgent },
      6000, 45000)
      .then(function (r) {
        herstel();
        if (r.status !== 'ok') { $('l-code-fout').textContent = (r.fouten && r.fouten.code) || 'Inloggen lukte niet.'; return; }
        bewaarSessie({ sessie: r.sessie, email: r.email, verloopt: r.verloopt });
        toonApp();
      }).catch(function (err) { herstel(); $('l-code-fout').textContent = err.message; });
  });

  $('l-opnieuw').addEventListener('click', function () { toonLogin(); });

  $('uitloggen').addEventListener('click', function () {
    var s = sessieInGeheugen;
    wisSessie();
    $('lijst').innerHTML = ''; // niet zichtbaar voor een volgende gebruiker op dit apparaat
    // De lijstcache (alleen naam/status/startdatum, per e-mailadres) blijft staan: na opnieuw inloggen staat de lijst er meteen.
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
  // Lijst direct uit de browsercache (alleen naam, status en startdatum; geen persoonsgegevens) en daarna verversen.
  var LIJST_SLEUTEL = 'pf_beheer_lijst';

  function bewaarLijst(o) {
    try {
      localStorage.setItem(LIJST_SLEUTEL, JSON.stringify({
        email: sessieInGeheugen && sessieInGeheugen.email, testmodus: o.testmodus, testEmail: o.testEmail,
        medewerkers: o.medewerkers.map(function (m) {
          return { id: m.id, naam: m.naam, startdatum: m.startdatum, status: m.status, statusLabel: m.statusLabel };
        })
      }));
    } catch (e) { /* geen opslag beschikbaar */ }
  }
  function lijstUitCache() {
    try {
      var o = JSON.parse(localStorage.getItem(LIJST_SLEUTEL) || 'null');
      return o && sessieInGeheugen && o.email === sessieInGeheugen.email ? o : null;
    } catch (e) {
      return null;
    }
  }

  var ververstimer = null;
  function planVerversen() {
    clearTimeout(ververstimer);
    ververstimer = setTimeout(function () {
      // Alleen als het tabblad zichtbaar is, je bent ingelogd en geen detail of formulier open hebt.
      if (document.visibilityState === 'visible' && sessieInGeheugen && !$('app').hidden &&
        !$('detail').classList.contains('open') && $('formulier').hidden) laad(true);
      else planVerversen();
    }, 30000);
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && sessieInGeheugen && !$('app').hidden &&
      !$('detail').classList.contains('open')) laad(true);
  });

  function laad(stil) {
    var cache = lijstUitCache();
    if (cache && !stil && !$('lijst').innerHTML) toonLijst(cache);
    // Staat er al een lijst (uit de cache of eerder geladen)? Dan is verversen stil: geen rode balk bij een storing.
    stil = stil || !!$('lijst').innerHTML;
    roep('overzicht', [], function (o) {
      bewaarLijst(o);
      toonLijst(o);
      setTimeout(function () { haalDetailsVooraf(o.medewerkers); }, 1500);
      planVerversen();
    }, function () { planVerversen(); }, !!stil);
  }

  function toonLijst(o) {
    laatsteLijst = o.medewerkers;
    (function () {
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
    })();
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
    var herstelStart = bezig($('startKnop'), 'Bezig…');
    var invoer = {
      naam: $('f-naam').value,
      leeftijd: Number($('f-leeftijd').value),
      email: $('f-email').value,
      vervoermiddel: vervoer,
      startdatum: naarNl($('f-start').value)
    };
    roep('start', [invoer], function (r) {
      herstelStart();
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
      herstelStart();
    });
  });

  // ---------- Detail ----------
  function lijstHtml(rijen) {
    return '<dl>' + rijen.map(function (r) {
      return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>';
    }).join('') + '</dl>';
  }

  // Geopende details en foto's kort in het werkgeheugen van dit tabblad (niet op schijf: er staan BSN en IBAN in).
  var DETAIL_GELDIG_MS = 2 * 60 * 1000;
  var detailGeheugen = {};
  var fotoGeheugen = {};
  var laatsteLijst = [];

  function onthoudDetail(d, fotosOpnieuw) {
    detailGeheugen[d.id] = { d: d, op: Date.now() };
    if (fotosOpnieuw) delete fotoGeheugen[d.id]; // na een actie kunnen de foto's veranderd zijn
  }

  function openDetail(id) {
    $('detail').classList.add('open');
    $('detail').setAttribute('aria-hidden', 'false');
    var bewaard = detailGeheugen[id];
    if (bewaard && Date.now() - bewaard.op < DETAIL_GELDIG_MS) {
      toonDetail(bewaard.d, true);
    } else {
      // Meteen tonen wat al uit de lijst bekend is; de rest vult aan zodra het binnen is.
      var m = laatsteLijst.filter(function (x) { return x.id === id; })[0] || { naam: '', status: '', statusLabel: '', startdatum: '' };
      $('detailInhoud').innerHTML = '<button class="terug" data-actie="terug">‹ Terug</button>' +
        '<div class="kop-detail"><h1>' + esc(m.naam) + '</h1>' + (m.status ? badge(m.status, m.statusLabel) : '') + '</div>' +
        '<p class="klein">Start ' + esc(m.startdatum) + '</p>' +
        '<div class="kaart"><div class="laad-regel"></div><div class="laad-regel kort"></div><div class="laad-regel"></div>' +
        '<p class="klein">Gegevens laden…</p></div>';
      $('detailInhoud').dataset.id = id;
    }
    // Altijd verversen; stil als er al iets op het scherm staat.
    roep('detail', [id], function (d) {
      onthoudDetail(d);
      if ($('detail').classList.contains('open') && $('detailInhoud').dataset.id === id) toonDetail(d, true);
    }, null, !!bewaard);
  }

  /** Bovenste paar medewerkers alvast ophalen (stil, na elkaar), zodat hun detail direct opengaat. */
  var vooraf = false;
  function haalDetailsVooraf(lijst) {
    if (vooraf) return;
    vooraf = true;
    var ids = lijst.filter(function (m) { return m.status !== 'Geannuleerd'; }).slice(0, 3).map(function (m) { return m.id; })
      .filter(function (id) { return !detailGeheugen[id]; });
    (function volgende() {
      var id = ids.shift();
      if (!id) { vooraf = false; return; }
      roep('detail', [id], function (d) { onthoudDetail(d); volgende(); }, function () { vooraf = false; }, true);
    })();
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
      '<div class="miniaturen">' + (v.fotos.length ? '' : '<span class="klein">Foto’s laden…</span>') + v.fotos.map(function (f) {
        return '<button data-actie="foto" data-naam="' + esc(f.naam) + '" aria-label="' + esc(f.naam) + ' groot bekijken">' +
          '<img src="' + esc(f.src) + '" alt=""></button>';
      }).join('') + '</div></div>';
  }

  function toonDetail(d, alOnthouden) {
    if (!alOnthouden) onthoudDetail(d, true); // aangeroepen na een actie
    var acties = '';
    if (d.kanOpnieuwUitnodigen) acties += '<button class="knop licht" data-actie="opnieuw">Uitnodiging opnieuw sturen</button>';
    if (d.loonheffingUrl) acties += pdfKnop('loonheffing', 'Loonheffingsverklaring');
    else if (d.loonheffingBezig) acties += '<div class="klein midden">Loonheffingsverklaring wordt gemaakt (binnen 5 minuten).</div>';
    if (d.heeftContract) acties += pdfKnop('contract', d.contractGetekend ? 'Contract (getekend)' : 'Contract (nog niet getekend)');
    if (d.mapUrl) acties += '<a class="knop licht link" target="_blank" rel="noopener" href="' + esc(d.mapUrl) + '">Drive-map openen</a>';
    if (d.kanContractOpnieuw) acties += '<button class="knop licht" data-actie="contract-opnieuw" data-gezien="' +
      esc(d.contractGemaaktOp) + '">Contract opnieuw maken</button>';
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
    if (d.vergelijk) {
      var zetFotos = function (fotos) {
        var vak = document.querySelector('#detailInhoud .miniaturen');
        if (!vak || $('detailInhoud').dataset.id !== d.id) return;
        if (!fotos.length) { vak.innerHTML = '<span class="klein">Geen foto’s</span>'; return; }
        vak.innerHTML = fotos.map(function (f) {
          // Zonder voorbeeld: een knop die pas bij tikken het origineel laadt.
          return '<button data-actie="foto" data-naam="' + esc(f.naam) + '" aria-label="' + esc(f.naam) + ' groot bekijken">' +
            (f.src ? '<img src="' + esc(f.src) + '" alt="">' : '<span class="foto-knop">Bekijk</span>') + '</button>';
        }).join('');
      };
      if (fotoGeheugen[d.id]) { zetFotos(fotoGeheugen[d.id]); return; }
      roep('miniaturen', [d.id], function (fotos) {
        fotoGeheugen[d.id] = fotos;
        zetFotos(fotos);
      }, function () {
        var vak = document.querySelector('#detailInhoud .miniaturen');
        if (vak && $('detailInhoud').dataset.id === d.id) vak.innerHTML = '<span class="klein">Foto’s niet geladen</span>';
      });
    }
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
    lb.innerHTML = '<img alt="ID-foto"><p class="klein">Foto laden…</p>';
    if (src) lb.firstChild.src = src;
    else lb.firstChild.hidden = true;
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
      var herstelPdf = bezig(el, 'Laden…');
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
      }, herstelPdf);
      return;
    }
    if (actie === 'foto') {
      var mini = el.querySelector('img');
      toonFoto(mini ? mini.src : ''); // eerst de miniatuur (als die er is), dan scherp
      roep('fotoGroot', [id, el.dataset.naam], function (src) {
        var img = document.querySelector('#lightbox img');
        if (img) { img.src = src; img.hidden = false; }
        var tekst = document.querySelector('#lightbox p');
        if (tekst) tekst.remove();
      });
      return;
    }
    if (actie === 'leeftijd-berekend') {
      bevestig('Leeftijd ' + el.dataset.leeftijd + ' vastleggen?',
        'De bedragen worden definitief op ' + el.dataset.leeftijd + ' jaar gezet. Daarna wordt het contract gemaakt en gemaild.',
        el.dataset.leeftijd + ' klopt').then(function (ja) {
        if (!ja) return;
        var herstel = bezig(el);
        roep('leeftijdKlopt', [id, 'berekend', ''], function (d) {
          toonDetail(d); toon('Leeftijd bevestigd, bedragen vastgelegd.'); laad(true);
        }, herstel);
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
      var herstelGeb = bezig(el);
      roep('leeftijdKlopt', [id, 'opgegeven', geb], function (d) {
        toonDetail(d); toon('Leeftijd en geboortedatum opgeslagen. Loonheffingsverklaring wordt opnieuw gemaakt.'); laad(true);
      }, function (e) { herstelGeb(); $('datumFout').textContent = (e && e.message) || ''; });
      return;
    }
    if (actie === 'opnieuw') {
      var herstelUit = bezig(el);
      roep('opnieuwUitnodigen', [id], function (d) { toonDetail(d); toon('Uitnodiging opnieuw verstuurd.'); laad(true); },
        herstelUit);
    }
    if (actie === 'contract-opnieuw') {
      bevestig('Contract opnieuw maken?', 'Het huidige, nog niet getekende contract wordt vervangen door een nieuwe ' +
        'versie en de medewerker krijgt de ondertekenlink opnieuw per mail.', 'Opnieuw maken').then(function (ja) {
        if (!ja) return;
        var herstelC = bezig(el, 'Contract wordt gemaakt…');
        roep('contractOpnieuw', [id, Number(el.dataset.gezien) || 0], function (d) {
          toonDetail(d); toon('Contract opnieuw gemaakt en gemaild.'); laad(true);
        }, herstelC);
      });
    }
    if (actie === 'annuleer') {
      bevestig('Aanmelding annuleren?', 'De links in de mails werken daarna niet meer. Dit kun je niet ongedaan maken.',
        'Annuleren', true, 'Niet annuleren').then(function (ja) {
        if (!ja) return;
        var herstelAn = bezig(el);
        roep('annuleren', [id], function (d) { toonDetail(d); toon('Geannuleerd.'); laad(true); }, herstelAn);
      });
    }
  });

  if (sessieInGeheugen) toonApp();
  else toonLogin();
})();
