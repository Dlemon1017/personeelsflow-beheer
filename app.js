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
  // Lezen in Nmbrs (kan even duren): niet dubbel versturen, maar de lijst ook niet als verouderd markeren.
  var NMBRS_LEZEN = ['nmbrsProefrun', 'nmbrsKandidaten', 'nmbrsRedenen'];
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
      if (ALLEEN_LEZEN.indexOf(fn) === -1 && NMBRS_LEZEN.indexOf(fn) === -1) naEigenActie();
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
        email: sessieInGeheugen && sessieInGeheugen.email, testmodus: o.testmodus, testEmail: o.testEmail, op: Date.now(),
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

  // Na een eigen actie (terugsturen, verwerkt, …) kan de lijst verouderd zijn: markeren en direct vers ophalen.
  var naActieTimer = null;
  function naEigenActie() {
    markeerVoorlopig(true);
    clearTimeout(naActieTimer);
    naActieTimer = setTimeout(function () { laad(true); }, 300);
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

  // Cache jonger dan dit: gewoon tonen. Ouder: tonen als voorlopig ("Bijwerken…", gedimd) tot de verse lijst er is.
  var CACHE_VERS_MS = 30 * 1000;

  function markeerVoorlopig(aan) {
    $('lijst').classList.toggle('voorlopig', aan);
    $('bijwerken').hidden = !aan;
  }

  function laad(stil) {
    var cache = lijstUitCache();
    if (cache && !stil && !$('lijst').innerHTML) {
      toonLijst(cache, true);
      markeerVoorlopig(!(cache.op && Date.now() - cache.op < CACHE_VERS_MS));
    }
    // Staat er al een lijst (uit de cache of eerder geladen)? Dan is verversen stil: geen rode balk bij een storing.
    stil = stil || !!$('lijst').innerHTML;
    roep('overzicht', [], function (o) {
      bewaarLijst(o);
      toonLijst(o);
      setTimeout(function () { haalDetailsVooraf(o.medewerkers); }, 1500);
      planVerversen();
    }, function () { planVerversen(); }, !!stil);
  }

  function toonSidesBijwerken(items) {
    $('sidesBijwerken').hidden = !(items && items.length);
    if (!items || !items.length) return;
    $('sidesItems').innerHTML = items.map(function (i) {
      return '<div class="sides-item"><div class="wie"><div class="naam">' + esc(i.naam) + '</div>' +
        '<div class="klein">' + esc(i.reden) + ' · vanaf ' + esc(i.vanaf) + '</div>' +
        '<div class="sides-bedrag">Sides € ' + esc(i.oudSides) + ' → <strong>€ ' + esc(i.nieuwSides) + '</strong></div>' +
        '<div class="klein">Nmbrs: ' + esc(i.nieuweTabel) + ', basisuurloon € ' + esc(i.nieuwBasis) + '</div></div>' +
        '<button class="knop licht klein-knop" data-sides-id="' + esc(i.id) + '">Bijgewerkt</button></div>';
    }).join('');
  }

  $('sidesItems').addEventListener('click', function (e) {
    var knop = e.target.closest('[data-sides-id]');
    if (!knop) return;
    var herstel = bezig(knop, 'Bezig…');
    roep('sidesBijgewerkt', [knop.dataset.sidesId], function (o) {
      bewaarLijst(o); toonLijst(o); toon('Sides bijgewerkt en vastgelegd.');
    }, herstel);
  });

  function toonBanvo(items) {
    $('banvo').hidden = !(items && items.length);
    if (!items || !items.length) return;
    $('banvoItems').innerHTML = items.map(function (i) {
      return '<div class="sides-item"><div class="wie"><div class="naam">' + esc(i.naam) + ' · ' + esc(i.label) + '</div>' +
        '<div class="sides-bedrag">' + esc(i.oud || '–') + ' → <strong>' + esc(i.nieuw || '–') + '</strong></div>' +
        '<div class="klein">' + esc(i.op) + ' · ' + esc(i.door) + (i.opmerking ? ' · ' + esc(i.opmerking) : '') + '</div></div>' +
        '<button class="knop licht klein-knop" data-banvo-rij="' + esc(i.rij) + '">Doorgegeven</button></div>';
    }).join('');
  }

  $('banvoItems').addEventListener('click', function (e) {
    var knop = e.target.closest('[data-banvo-rij]');
    if (!knop) return;
    var herstel = bezig(knop, 'Bezig…');
    roep('banvoDoorgegeven', [Number(knop.dataset.banvoRij)], function (o) {
      bewaarLijst(o); toonLijst(o); toon('Afgevinkt als doorgegeven aan Banvo.');
    }, herstel);
  });

  function toonLijst(o, uitCache) {
    if (!uitCache) markeerVoorlopig(false); // verse gegevens van de server
    laatsteLijst = o.medewerkers;
    if (o.banvo) toonBanvo(o.banvo);
    if (o.sidesBijwerken) toonSidesBijwerken(o.sidesBijwerken);
    (function () {
      var actief = o.medewerkers.filter(function (m) { return m.status !== 'Geannuleerd' && m.status !== 'Uit dienst'; }).length;
      $('telling').textContent = actief === 1 ? '1 medewerker in de flow' : actief + ' medewerkers in de flow';
      $('testbalk').hidden = !o.testmodus;
      $('testbalk').textContent = 'Testmodus: alle mails gaan naar ' + o.testEmail + '.';
      if (!o.medewerkers.length) {
        $('lijst').innerHTML = '<div class="leeg">Nog niemand. Tik op Nieuwe medewerker om te beginnen.</div>';
        return;
      }
      $('lijst').innerHTML = o.medewerkers.map(function (m) {
        return '<button class="item' + (m.status === 'Geannuleerd' || m.status === 'Uit dienst' ? ' uit' : '') + '" data-id="' + esc(m.id) + '">' +
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

  function kopieerRij(label, waarde) {
    return '<div><dt>' + esc(label) + '</dt><dd>' + esc(waarde || '–') +
      (waarde ? ' <button class="kopieer" data-actie="kopieer" data-waarde="' + esc(waarde) + '" aria-label="' + esc(label) +
        ' kopiëren">Kopieer</button>' : '') + '</dd></div>';
  }

  function nmbrsKaartHtml(d) {
    var a = d.nmbrsAanmaak;
    var onvolledig = a && !a.klaar;
    return '<div class="kaart werkkaart"><h2>Nmbrs</h2>' + d.nmbrs.map(function (g) {
      return '<h3 class="groep">' + esc(g.titel) + '</h3><dl>' + g.velden.map(function (v) { return kopieerRij(v[0], v[1]); }).join('') + '</dl>';
    }).join('') +
      (d.nmbrsKoppeling ? '<p class="klaar-tekst">✓ ' + (d.nmbrsKoppeling.aangemaakt ? 'Aangemaakt in' : 'Gekoppeld aan') + ' Nmbrs' +
        (d.nmbrsKoppeling.op ? ' (' + esc(d.nmbrsKoppeling.op) + (d.nmbrsKoppeling.door ? ' · ' + esc(d.nmbrsKoppeling.door) : '') + ')' : '') +
        '</p>' : '') +
      (onvolledig ? '<div class="fout mt12">Aanmaken in Nmbrs onvolledig: ' + a.gedaan + ' van ' + a.totaal + ' stappen gelukt. ' +
        'Ontbrekend: ' + esc(a.ontbrekend.join(', ')) + '.</div>' : '') +
      '<div class="knoppen-rij mt12"><button class="knop licht klein-knop" data-actie="nmbrs-proefrun">Proefrun Nmbrs</button>' +
      (onvolledig ? '<button class="knop klein-knop" data-actie="nmbrs-aanmaken">Ontbrekende stappen afmaken</button>' : '') +
      (d.nmbrsKoppeling ? '' : '<button class="knop klein-knop" data-actie="nmbrs-aanmaken">Aanmaken in Nmbrs</button>' +
        '<button class="knop licht klein-knop" data-actie="nmbrs-koppel">Bestaande Nmbrs-medewerker koppelen</button>') +
      '</div>' +
      (d.nmbrsVerwerkt ? '<p class="klaar-tekst">✓ Nmbrs verwerkt</p>'
      : '<button class="knop mt12" data-actie="verwerkt" data-welk="nmbrs">Nmbrs verwerkt</button>') + '</div>';
  }

  function sidesKaartHtml(d) {
    return '<div class="kaart werkkaart"><h2>Sides</h2><dl>' + d.sides.map(function (v) { return kopieerRij(v[0], v[1]); }).join('') +
      '</dl>' + (d.sidesNummer && d.sidesNummer.wijzigbaar ?
        '<button class="knop licht klein-knop" data-actie="sides-nummer">Personeelsnummer wijzigen</button>' : '') +
      (d.sidesVerwerkt ? '<p class="klaar-tekst">✓ Sides verwerkt</p>'
      : '<button class="knop mt12" data-actie="verwerkt" data-welk="sides">Sides verwerkt</button>') + '</div>';
  }

  function toonDetail(d, alOnthouden) {
    if (!alOnthouden) onthoudDetail(d, true); // aangeroepen na een actie
    var acties = '';
    if (d.herinnering) acties += '<button class="knop licht" data-actie="herinnering">Herinnering nu sturen (' +
      ({ formulier: 'formulier', terug: 'correctie', contract: 'contract' }[d.herinnering] || d.herinnering) + ')</button>';
    if (d.kanOpnieuwUitnodigen) acties += '<button class="knop licht" data-actie="opnieuw">Uitnodiging opnieuw sturen</button>';
    if (d.loonheffingUrl) acties += pdfKnop('loonheffing', 'Loonheffingsverklaring');
    else if (d.loonheffingBezig) acties += '<div class="klein midden">Loonheffingsverklaring wordt gemaakt (binnen 5 minuten).</div>';
    if (d.heeftContract) acties += pdfKnop('contract', d.contractGetekend ? 'Contract (getekend)' : 'Contract (nog niet getekend)');
    if (d.mapUrl) acties += '<a class="knop licht link" target="_blank" rel="noopener" href="' + esc(d.mapUrl) + '">Drive-map openen</a>';
    if (d.kanContractOpnieuw) acties += '<button class="knop licht" data-actie="contract-opnieuw" data-gezien="' +
      esc(d.contractGemaaktOp) + '">Contract opnieuw maken</button>';
    if (d.kanTerugsturen) acties += '<button class="knop licht" data-actie="terugsturen">Terugsturen naar medewerker</button>';
    if (d.correctie) acties += '<button class="knop licht" data-actie="corrigeer">Gegevens corrigeren</button>';
    if (d.wijzigingslink) {
      acties += '<button class="knop licht" data-actie="wijzigingslink">Wijzigingslink ' + (d.wijzigingslink.actief ? 'opnieuw ' : '') + 'sturen</button>';
      if (d.wijzigingslink.actief) acties += '<button class="knop licht" data-actie="wijzigingslink-in">Wijzigingslink intrekken</button>';
    }
    if (d.kanUitDienst) acties += '<button class="knop licht" data-actie="uit-dienst">Uit dienst</button>';
    if (d.kanAnnuleren) acties += '<button class="knop gevaar" data-actie="annuleer">Annuleren</button>';

    $('detailInhoud').innerHTML =
      '<button class="terug" data-actie="terug">‹ Terug</button>' +
      '<div class="kop-detail"><h1>' + esc(d.naam) + '</h1>' + badge(d.status, d.statusLabel) + '</div>' +
      (d.controle ? controleHtml(d.controle) : '') +
      (d.terug ? '<div class="test mt12">↩ Teruggestuurd (' + esc(d.terug.stappen.join(', ')) + '): ' + esc(d.terug.reden) + '</div>' : '') +
      (d.uitDienst ? '<div class="test mt12">Uit dienst per ' + esc(d.uitDienst.op) + (d.uitDienst.reden ? ' · ' + esc(d.uitDienst.reden) : '') +
        (d.uitDienst.nmbrs ? ' · gemeld in Nmbrs ' + esc(d.uitDienst.nmbrs) : ' · niet in Nmbrs gemeld') + '</div>' : '') +
      (d.nmbrs ? nmbrsKaartHtml(d) : '') + (d.sides ? sidesKaartHtml(d) : '') +
      (d.controle ? (d.waarschuwingenOverig ? '<div class="test mt12">⚠ ' + esc(d.waarschuwingenOverig) + '</div>' : '') :
        d.waarschuwingen ? '<div class="test mt12">⚠ ' + esc(d.waarschuwingen) + '</div>' : '') +
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

  /** Eenvoudig informatievenster met een Sluiten-knop. */
  function infoDialoog(titel, html) {
    var achter = document.createElement('div');
    achter.className = 'dialoog-achter';
    achter.innerHTML = '<div class="dialoog groot" role="dialog" aria-modal="true"><h2>' + esc(titel) + '</h2>' + html +
      '<div class="dialoog-knoppen"><button class="knop" data-keuze="ok">Sluiten</button></div></div>';
    achter.addEventListener('click', function (e) { if (e.target === achter || e.target.closest('[data-keuze]')) achter.remove(); });
    document.body.appendChild(achter);
  }

  function planHtml(stappen) {
    return stappen.map(function (s, i) {
      return '<div class="plan-stap"><div><strong>' + (i + 1) + '. ' + esc(s.stap) + (s.gedaan ? ' ✓ al gedaan' : '') +
        '</strong> <span class="klein">' + esc(s.methode) + ' ' +
        esc(s.pad) + '</span></div>' + (s.open && s.open.length ? '<div class="fout">Open: ' + esc(s.open.join(' ')) + '</div>' : '') +
        (s.letOp && s.letOp.length ? '<div class="klein">Let op: ' + esc(s.letOp.join(' ')) + '</div>' : '') +
        '<pre class="plan-json">' + esc(JSON.stringify(s.body, null, 2)) + '</pre></div>';
    }).join('');
  }

  function proefrunHtml(r) {
    var open = r.stappen.reduce(function (n, s) { return n + (s.open ? s.open.length : 0); }, 0);
    return '<p>BSN en IBAN zijn gemaskeerd. Schrijven naar Nmbrs staat <strong>' + (r.schrijvenAan ? 'AAN' : 'uit') + '</strong>.' +
      (r.sjabloon ? ' Sjabloon: ' + esc(r.sjabloon) + '.' : '') + (r.soort ? ' Soort: ' + esc(r.soort) + '.' : '') + '</p>' +
      (r.template ? '<div class="test mt12">Default medewerker: <strong>' + esc(r.template.naam) + '</strong> · template-ID ' +
        esc(r.template.id) + '</div>' : '') +
      (r.nationaliteit ? '<div class="test mt12">Nationaliteit: <strong>' + esc(r.nationaliteit.invoer || '–') + '</strong> → ' +
        (r.nationaliteit.code ? '<strong>' + esc(r.nationaliteit.code) + '</strong>' : '<span class="fout">niet herkend</span>') +
        ' · Geboorteland: ' + esc(r.geboorteland.invoer || '–') + ' → ' + esc(r.geboorteland.code || 'leeg') + '</div>' : '') +
      (r.hervatten ? '<div class="test mt12">Deze medewerker is al aangemaakt; alleen de stappen zonder ✓ worden nog uitgevoerd.</div>' : '') +
      (r.waarschuwingen.length ? '<div class="fout mt12"><strong>Niet aanmaken:</strong><br>' + r.waarschuwingen.map(esc).join('<br>') + '</div>' : '') +
      '<p class="klein">' + r.stappen.length + ' stappen, ' + open + ' open punt(en).</p>' + planHtml(r.stappen);
  }

  /** Proefrun + bevestiging voor aanmaken in Nmbrs. Promise<true | false>. Bevestigen alleen als de server het toestaat. */
  function aanmaakDialoog(r) {
    return new Promise(function (klaar) {
      var achter = document.createElement('div');
      achter.className = 'dialoog-achter';
      achter.innerHTML = '<div class="dialoog groot" role="dialog" aria-modal="true"><h2>' +
        (r.hervatten ? 'Ontbrekende stappen afmaken in Nmbrs' : 'Aanmaken in Nmbrs') + '</h2>' + proefrunHtml(r) +
        (r.kanAanmaken ? '<p><strong>Dit maakt de medewerker echt aan in Nmbrs.</strong> Controleer de stappen hierboven.</p>' :
          '<p class="fout">' + (r.schrijvenAan ? 'Aanmaken kan niet (zie hierboven).' :
            'Schrijven naar Nmbrs staat uit (Instellingen › nmbrs_schrijven_aan).') + '</p>') +
        '<div class="dialoog-knoppen"><button class="knop licht" data-keuze="nee">Terug</button>' +
        (r.kanAanmaken ? '<button class="knop" data-keuze="ja">' + (r.hervatten ? 'Bevestigen: afmaken' : 'Bevestigen: aanmaken in Nmbrs') +
          '</button>' : '') + '</div></div>';
      function sluit(uitkomst) { document.removeEventListener('keydown', toets); achter.remove(); klaar(uitkomst); }
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

  /** Kies een bestaande Nmbrs-medewerker om te koppelen. Promise<employeeId | null>. */
  function koppelDialoog(kandidaten) {
    return new Promise(function (klaar) {
      var achter = document.createElement('div');
      achter.className = 'dialoog-achter';
      achter.innerHTML = '<div class="dialoog groot" role="dialog" aria-modal="true"><h2>Bestaande Nmbrs-medewerker koppelen</h2>' +
        (kandidaten.length ? '<p>Gevonden op achternaam + geboortedatum (of BSN). Kies de juiste en bevestig. Er wordt niets in Nmbrs aangemaakt.</p>' +
          kandidaten.map(function (k, i) {
            return '<label class="vink-regel"><input type="radio" name="kand" value="' + esc(k.employeeId) + '"' + (i === 0 ? ' checked' : '') + '> ' +
              esc(k.naam) + ' · geb. ' + esc(k.geboortedatum) + ' · personeelsnr. ' + esc(String(k.nummer)) + ' · ' + esc(k.soort) +
              (k.bsnGelijk ? ' · <strong>BSN komt overeen</strong>' : '') + (k.naamGelijk ? '' : ' · naam/geboortedatum wijken af') + '</label>';
          }).join('') : '<p>Geen Nmbrs-medewerker gevonden met dezelfde achternaam en geboortedatum (of BSN).</p>') +
        '<div class="dialoog-knoppen"><button class="knop licht" data-keuze="nee">Annuleren</button>' +
        (kandidaten.length ? '<button class="knop" data-keuze="ja">Koppelen</button>' : '') + '</div></div>';
      achter.addEventListener('click', function (e) {
        if (e.target === achter) { achter.remove(); return klaar(null); }
        var k = e.target.closest('[data-keuze]');
        if (!k) return;
        var gekozen = achter.querySelector('input[name=kand]:checked');
        achter.remove();
        klaar(k.dataset.keuze === 'ja' && gekozen ? gekozen.value : null);
      });
      document.body.appendChild(achter);
    });
  }

  /** Uit dienst: einddatum + reden (lijst uit Nmbrs). Promise<{datum, code, reden} | null>. */
  function uitDienstDialoog() {
    return new Promise(function (klaar) {
      var achter = document.createElement('div');
      achter.className = 'dialoog-achter';
      achter.innerHTML = '<div class="dialoog" role="dialog" aria-modal="true"><h2>Uit dienst</h2>' +
        '<p>Zet de medewerker uit dienst. Het Sides-nummer komt daarna vrij voor hergebruik.</p>' +
        '<label for="uDatum">Laatste werkdag (einddatum)</label><input id="uDatum" type="date">' +
        '<label for="uReden">Reden (Nmbrs)</label><select id="uReden"><option value="">Laden…</option></select>' +
        '<div class="fout" id="uFout"></div><div class="dialoog-knoppen"><button class="knop licht" data-keuze="nee">Annuleren</button>' +
        '<button class="knop gevaar" data-keuze="ja">Uit dienst zetten</button></div></div>';
      var sel = achter.querySelector('#uReden');
      roep('nmbrsRedenen', [], function (r) {
        sel.innerHTML = '<option value="">' + (r.lijst.length ? 'Kies een reden' : 'Geen lijst uit Nmbrs (' + esc(r.fout || 'niet bereikbaar') + ')') + '</option>' +
          r.lijst.map(function (x) { return '<option value="' + esc(String(x.code)) + '">' + esc(x.code + ' – ' + x.reden) + '</option>'; }).join('');
        if (r.lijst.some(function (x) { return String(x.code) === '20'; })) sel.value = '20'; // standaard: opzegging door werknemer
      }, function () { sel.innerHTML = '<option value="">Geen lijst uit Nmbrs</option>'; }, true);
      achter.addEventListener('click', function (e) {
        if (e.target === achter) { achter.remove(); return klaar(null); }
        var k = e.target.closest('[data-keuze]');
        if (!k) return;
        if (k.dataset.keuze === 'nee') { achter.remove(); return klaar(null); }
        var datum = achter.querySelector('#uDatum').value;
        if (!datum) { achter.querySelector('#uFout').textContent = 'Kies een einddatum.'; return; }
        var opt = sel.options[sel.selectedIndex];
        achter.remove();
        klaar({ datum: datum, code: sel.value, reden: sel.value ? opt.textContent.replace(/^\S+ – /, '') : '' });
      });
      document.body.appendChild(achter);
    });
  }

  /** Venster "Personeelsnummer wijzigen" (Sides). Geeft Promise<nummer als tekst | null>. */
  function sidesNummerDialoog(oud) {
    return new Promise(function (klaar) {
      var achter = document.createElement('div');
      achter.className = 'dialoog-achter';
      achter.innerHTML = '<div class="dialoog" role="dialog" aria-modal="true" aria-labelledby="sTitel">' +
        '<h2 id="sTitel">Sides-personeelsnummer</h2><p>Voorgesteld: <strong>' + esc(oud) + '</strong>. Je kunt bijvoorbeeld ' +
        'een vrijgekomen nummer van een gestopte medewerker hergebruiken. Een lager nummer verandert de teller voor ' +
        'nieuwe medewerkers niet.</p><label for="sNummer">Nieuw nummer</label>' +
        '<input id="sNummer" inputmode="numeric" maxlength="6" value="' + esc(oud) + '">' +
        '<div class="fout" id="sFout"></div><div class="dialoog-knoppen"><button class="knop licht" data-keuze="nee">Annuleren</button>' +
        '<button class="knop" data-keuze="ja">Opslaan</button></div></div>';
      function sluit(uitkomst) { achter.remove(); klaar(uitkomst); }
      function opslaan() {
        var w = achter.querySelector('#sNummer').value.trim();
        if (!/^\d{1,6}$/.test(w) || Number(w) < 1) { achter.querySelector('#sFout').textContent = 'Vul een geheel getal van 1 of hoger in.'; return; }
        sluit(String(Number(w)));
      }
      achter.addEventListener('click', function (e) {
        if (e.target === achter) return sluit(null);
        var k = e.target.closest('[data-keuze]');
        if (!k) return;
        if (k.dataset.keuze === 'nee') return sluit(null);
        opslaan();
      });
      achter.querySelector('#sNummer').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); opslaan(); } });
      document.body.appendChild(achter);
      var invoer = achter.querySelector('#sNummer');
      invoer.focus();
      invoer.select();
    });
  }

  /** Venster "Terugsturen": stappen aanvinken + korte reden. Geeft Promise<{stappen, reden}|null>. */
  function terugsturenDialoog() {
    return new Promise(function (klaar) {
      var namen = ['Over jou', 'Adres en contact', 'Bank en ID', 'Belasting en handtekening'];
      var achter = document.createElement('div');
      achter.className = 'dialoog-achter';
      achter.innerHTML = '<div class="dialoog" role="dialog" aria-modal="true" aria-labelledby="tTitel">' +
        '<h2 id="tTitel">Terugsturen naar medewerker</h2><p>Welke stap(pen) moet de medewerker aanpassen? ' +
        'Stap 4 (handtekening) gaat altijd mee.</p>' + namen.map(function (n, i) {
          return '<label class="vink-regel"><input type="checkbox" value="' + i + '"' + (i === 3 ? ' checked disabled' : '') + '> ' + n + '</label>';
        }).join('') + '<label for="tReden">Reden (komt in de mail)</label><textarea id="tReden" rows="3" maxlength="300"></textarea>' +
        '<div class="fout" id="tFout"></div><div class="dialoog-knoppen"><button class="knop licht" data-keuze="nee">Terug</button>' +
        '<button class="knop" data-keuze="ja">Terugsturen</button></div></div>';
      function sluit(uitkomst) { achter.remove(); klaar(uitkomst); }
      achter.addEventListener('click', function (e) {
        if (e.target === achter) return sluit(null);
        var k = e.target.closest('[data-keuze]');
        if (!k) return;
        if (k.dataset.keuze === 'nee') return sluit(null);
        var stappen = Array.prototype.filter.call(achter.querySelectorAll('input[type=checkbox]'), function (c) { return c.checked; })
          .map(function (c) { return Number(c.value); });
        var reden = achter.querySelector('#tReden').value.trim();
        if (!reden) { achter.querySelector('#tFout').textContent = 'Vul een korte reden in.'; return; }
        sluit({ stappen: stappen, reden: reden });
      });
      document.body.appendChild(achter);
      achter.querySelector('input').focus();
    });
  }

  var CORRECTIE_LABELS = { roepnaam: 'Roepnaam', voornamen: 'Voornamen', tussenvoegsel: 'Tussenvoegsel', achternaam: 'Achternaam',
    straat: 'Straat', huisnummer: 'Huisnummer', toevoeging: 'Toevoeging', postcode: 'Postcode', woonplaats: 'Woonplaats',
    mobiel: 'Mobiel', noodcontact_naam: 'Noodcontact', noodcontact_relatie: 'Relatie noodcontact', noodcontact_telefoon: 'Telefoon noodcontact' };

  /** Venster "Gegevens corrigeren": alleen naam, adres, telefoon en noodcontact (niet BSN, IBAN, loonheffingskorting). */
  function corrigeerDialoog(id, huidig) {
    var achter = document.createElement('div');
    achter.className = 'dialoog-achter';
    achter.innerHTML = '<div class="dialoog groot" role="dialog" aria-modal="true" aria-labelledby="cTitel">' +
      '<h2 id="cTitel">Gegevens corrigeren</h2><p>BSN, IBAN en loonheffingskorting kan alleen de medewerker wijzigen.</p>' +
      Object.keys(CORRECTIE_LABELS).map(function (v) {
        return '<label for="c-' + v + '">' + CORRECTIE_LABELS[v] + '</label><input id="c-' + v + '" data-veld="' + v + '">' +
          '<div class="fout" data-cfout="' + v + '"></div>';
      }).join('') + '<div class="dialoog-knoppen"><button class="knop licht" data-keuze="nee">Annuleren</button>' +
      '<button class="knop" data-keuze="ja">Opslaan</button></div></div>';
    Object.keys(CORRECTIE_LABELS).forEach(function (v) { achter.querySelector('#c-' + v).value = huidig[v] || ''; });
    achter.addEventListener('click', function (e) {
      if (e.target === achter) return achter.remove();
      var k = e.target.closest('[data-keuze]');
      if (!k) return;
      if (k.dataset.keuze === 'nee') return achter.remove();
      var velden = {};
      Object.keys(CORRECTIE_LABELS).forEach(function (v) {
        var w = achter.querySelector('#c-' + v).value;
        if (w !== (huidig[v] || '')) velden[v] = w;
      });
      if (!Object.keys(velden).length) { achter.remove(); return; }
      var herstel = bezig(k, 'Opslaan…');
      roep('corrigeer', [id, velden, huidig], function (r) {
        if (r.fouten) {
          herstel();
          Array.prototype.forEach.call(achter.querySelectorAll('[data-cfout]'), function (el) { el.textContent = r.fouten[el.dataset.cfout] || ''; });
          return;
        }
        achter.remove();
        if (r.id) { toonDetail(r); return; } // "Intussen gewijzigd": actuele gegevens, melding komt via roep()
        if (r.detail) toonDetail(r.detail);
        toon(r.niets ? 'Er was niets gewijzigd.' : 'Gegevens gecorrigeerd en vastgelegd in tab Wijzigingen.');
        laad(true);
      }, function () { herstel(); achter.remove(); });
    });
    var na = achter.querySelector('[data-cfout="toevoeging"]');
    var melding = document.createElement('p');
    melding.className = 'adres-melding';
    melding.hidden = true;
    na.parentNode.insertBefore(melding, na.nextSibling);
    koppelAdresZoeker(achter, melding);
    document.body.appendChild(achter);
    achter.querySelector('input').focus();
  }

  /**
   * Straat en woonplaats invullen na postcode + huisnummer (+ toevoeging) via PDOK (Kadaster, BAG; adres.js).
   * Alleen postcode en huisnummer gaan naar PDOK. Niet gevonden: melding; PDOK weg: niets doen.
   */
  function koppelAdresZoeker(achter, melding) {
    var veld = function (v) { return achter.querySelector('#c-' + v); };
    var timer = null;
    var laatste = '';
    function zoek() {
      var url = pdokUrl(veld('postcode').value, veld('huisnummer').value);
      if (!url) { melding.hidden = true; laatste = ''; return; }
      var sleutel = url + '|' + veld('toevoeging').value;
      if (sleutel === laatste) return;
      laatste = sleutel;
      fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
        .then(function (r) { if (!r.ok) throw new Error('PDOK'); return r.json(); })
        .then(function (j) {
          if (sleutel !== laatste) return;
          var o = bagOordeel(j.response.docs, { toevoeging: veld('toevoeging').value });
          if (o.nummerBestaat) { veld('straat').value = o.straat; veld('woonplaats').value = o.woonplaats; }
          melding.hidden = o.gevonden;
          melding.textContent = 'Dit adres staat niet in de BAG. Controleer postcode, huisnummer en toevoeging.';
        })
        .catch(function () { laatste = ''; melding.hidden = true; });
    }
    ['postcode', 'huisnummer', 'toevoeging'].forEach(function (v) {
      veld(v).addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(zoek, 600); });
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
    if (actie === 'kopieer') {
      var waarde = el.dataset.waarde;
      (navigator.clipboard ? navigator.clipboard.writeText(waarde) : Promise.reject()).then(function () {
        toon('Gekopieerd: ' + waarde);
      }, function () { toon('Kopiëren lukte niet; selecteer de tekst handmatig.', true); });
      return;
    }
    if (actie === 'verwerkt') {
      var welk = el.dataset.welk;
      var herstelV = bezig(el);
      roep('verwerkt', [id, welk], function (d) {
        toonDetail(d);
        var mail = !d.inkloknummerMail ? '' : d.inkloknummerMail === 'verstuurd' ? ' Mail met inkloknummer verstuurd.' :
          ' Let op: mail met inkloknummer niet verstuurd (' + d.inkloknummerMail.replace(/^fout: /, '') + ').';
        toon((welk === 'nmbrs' ? 'Nmbrs' : 'Sides') + ' verwerkt.' + (d.status === 'Klaar' ? ' Status: Klaar.' : '') + mail,
          /niet verstuurd/.test(mail));
        laad(true);
      }, herstelV);
      return;
    }
    if (actie === 'nmbrs-proefrun') {
      var herstelP = bezig(el, 'Proefrun…');
      roep('nmbrsProefrun', [id], function (r) { herstelP(); infoDialoog('Proefrun Nmbrs (er gaat niets naar Nmbrs)', proefrunHtml(r)); }, herstelP);
      return;
    }
    if (actie === 'nmbrs-aanmaken') {
      var herstelA = bezig(el, 'Proefrun…');
      roep('nmbrsProefrun', [id], function (r) {
        herstelA();
        aanmaakDialoog(r).then(function (ja) {
          if (!ja) return;
          var herstelA2 = bezig(el, 'Aanmaken in Nmbrs…');
          roep('nmbrsAanmaken', [id], function (d) {
            toonDetail(d); laad(true);
            var u = d.nmbrsAanmaken || {};
            if (u.ok) { toon('Aangemaakt in Nmbrs (' + u.uitgevoerd + ' stappen). Nmbrs verwerkt staat aan.'); return; }
            infoDialoog('Aanmaken in Nmbrs gestopt', '<div class="fout">Mislukt bij stap <strong>' + esc(u.mislukt) + '</strong>: ' +
              esc(u.melding) + '</div><p>Nog niet gedaan: ' + esc((u.ontbrekend || []).join(', ')) + '.</p>' +
              '<p>De stappen daarvoor zijn wel opgeslagen. Los het probleem op en klik op de Nmbrs-kaart op ' +
              '<strong>Ontbrekende stappen afmaken</strong>. Er wordt dan geen tweede medewerker aangemaakt.</p>');
          }, herstelA2);
        });
      }, herstelA);
      return;
    }
    if (actie === 'nmbrs-koppel') {
      var herstelK = bezig(el, 'Zoeken in Nmbrs…');
      roep('nmbrsKandidaten', [id], function (r) {
        herstelK();
        koppelDialoog(r.kandidaten).then(function (employeeId) {
          if (!employeeId) return;
          var herstelK2 = bezig(el, 'Koppelen…');
          roep('nmbrsKoppel', [id, employeeId], function (d) { toonDetail(d); toon('Gekoppeld aan de bestaande Nmbrs-medewerker.'); }, herstelK2);
        });
      }, herstelK);
      return;
    }
    if (actie === 'uit-dienst') {
      uitDienstDialoog().then(function (k) {
        if (!k) return;
        var herstelU = bezig(el);
        roep('uitDienst', [id, k.datum, k.code, k.reden], function (d) {
          toonDetail(d); laad(true);
          var n = d.uitDienstNmbrs || {};
          toon('Uit dienst gezet.' + (n.modus === 'gemeld' ? ' Gemeld in Nmbrs.' : n.modus === 'proefrun' ? ' Nmbrs: alleen proefrun (schrijven staat uit).' :
            ' Niet gekoppeld aan Nmbrs.') + ' Het Sides-nummer is weer vrij.');
          if (n.modus === 'proefrun' && n.plan) infoDialoog('Proefrun uit dienst (er is niets naar Nmbrs gestuurd)', planHtml(n.plan));
        }, herstelU);
      });
      return;
    }
    if (actie === 'sides-nummer') {
      var huidigD = (detailGeheugen[id] || {}).d;
      var oud = huidigD && huidigD.sidesNummer ? huidigD.sidesNummer.waarde : '';
      sidesNummerDialoog(oud).then(function (nieuw) {
        if (nieuw === null || nieuw === oud) return;
        var herstelS = bezig(el);
        roep('sidesNummer', [id, nieuw, oud], function (d) {
          toonDetail(d); toon('Sides-personeelsnummer gewijzigd: ' + oud + ' → ' + d.sidesNummer.waarde + '.');
        }, herstelS);
      });
      return;
    }
    if (actie === 'terugsturen') {
      terugsturenDialoog().then(function (keuze) {
        if (!keuze) return;
        var herstelT = bezig(el);
        roep('terugsturen', [id, keuze.stappen, keuze.reden], function (d) {
          toonDetail(d); toon('Teruggestuurd; de medewerker krijgt een mail.'); laad(true);
        }, herstelT);
      });
      return;
    }
    if (actie === 'corrigeer') {
      var huidig = (detailGeheugen[id] || {}).d;
      if (huidig && huidig.correctie) corrigeerDialoog(id, huidig.correctie);
      return;
    }
    if (actie === 'wijzigingslink') {
      var herstelW = bezig(el);
      roep('wijzigingslink', [id], function (d) { toonDetail(d); toon('Wijzigingslink verstuurd.'); }, herstelW);
      return;
    }
    if (actie === 'wijzigingslink-in') {
      bevestig('Wijzigingslink intrekken?', 'De link in de mails werkt daarna niet meer. Je kunt later een nieuwe sturen.',
        'Intrekken', true).then(function (ja) {
        if (!ja) return;
        var herstelI = bezig(el);
        roep('wijzigingslinkIntrekken', [id], function (d) { toonDetail(d); toon('Wijzigingslink ingetrokken.'); }, herstelI);
      });
      return;
    }
    if (actie === 'herinnering') {
      var herstelH = bezig(el);
      roep('herinnering', [id], function (d) { toonDetail(d); toon('Herinnering verstuurd.'); laad(true); }, herstelH);
      return;
    }
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
