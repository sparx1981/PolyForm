// Dreieckscompiler fuer den semantischen Split-rail-Plan.
//
// Batchgrenzen sind Materialgrenzen, nicht Bauteilgrenzen: alles Holz landet in
// EINEM Batch, Feldsteine in einem zweiten, Weidenbindungen in einem dritten.
// Drei Draws fuer den ganzen Zaun.
//
// Kanten: Deckflaechen und Seitenflaechen bekommen getrennte Normalen ueber
// flatShading am Material; computeVertexNormals() wird bewusst NICHT benutzt, um
// harte Holzkanten zu erfinden - die Flaechen sind ohnehin flach.
//
// UV in Weltmass: u laeuft in Metern um den Querschnitt, v in Metern entlang des
// Bauteils. Die Maserung aendert sich damit nicht mit der Riegellaenge.

const EPSILON = 1e-8;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function hash01(value) {
  const x = Math.sin(value * 77.731 + 11.913) * 43758.5453;
  return x - Math.floor(x);
}

function createWriter(THREE) {
  const positions = [], colors = [], uvs = [];
  const addTriangle = (a, b, c, color, uvA = [0, 0], uvB = [0, 0], uvC = [0, 0]) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let index = 0; index < 3; index += 1) colors.push(color.r, color.g, color.b);
    uvs.push(...uvA, ...uvB, ...uvC);
  };
  const addQuad = (a, b, c, d, color, uvA = [0, 0], uvB = [0, 1], uvC = [1, 1], uvD = [1, 0]) => {
    addTriangle(a, b, c, color, uvA, uvB, uvC);
    addTriangle(a, c, d, color, uvA, uvC, uvD);
  };
  const finish = () => {
    if (!positions.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  };
  return { addTriangle, addQuad, finish, get triangleCount() { return positions.length / 9; } };
}

// ---------------------------------------------------------------------------
// Holzbilder
// ---------------------------------------------------------------------------

const PALETTEN = {
  'kastanie-frisch': { riegel: '#cdae7f', pfosten: '#b18f63', ende: '#e3cca3', streuung: 0.12 },
  eiche: { riegel: '#9a8360', pfosten: '#836d47', ende: '#bca47c', streuung: 0.11 },
  robinie: { riegel: '#b09457', pfosten: '#91773e', ende: '#d0b573', streuung: 0.11 },
  vergraut: { riegel: '#9c9a91', pfosten: '#87847c', ende: '#b4b1a8', streuung: 0.095 },
  flechte: { riegel: '#9b9f8f', pfosten: '#84887a', ende: '#b0b3a4', streuung: 0.13 }
};

export function holzFarbe(THREE, holzbild, index, seed, rolle = 'riegel') {
  const palette = PALETTEN[holzbild] || PALETTEN.vergraut;
  const basis = rolle === 'ende' ? palette.ende : rolle === 'pfosten' ? palette.pfosten : palette.riegel;
  const helligkeit = (hash01(seed * 41 + index * 29 + rolle.length * 13) - 0.5) * palette.streuung;
  const ton = (hash01(index * 13 + seed * 7) - 0.5) * 0.02;
  return new THREE.Color(basis).offsetHSL(ton, -0.012, helligkeit);
}

// ---------------------------------------------------------------------------
// Querschnitte. Ein gespaltener Riegel ist kein Rechteck: eine glatte Spaltflaeche,
// eine gewachsene Rueckseite, unregelmaessige Kanten.
// ---------------------------------------------------------------------------

// Alle Profile laufen nach der Normierung GEGEN den Uhrzeigersinn. Ohne diese
// Normierung haengt die Flaechenrichtung eines Bauteils davon ab, in welcher
// Reihenfolge jemand die Profilpunkte aufgeschrieben hat - und ein einziges
// falsch herum notiertes Profil erzeugt ein Bauteil, das der Renderer von innen
// zeigt. Genau das war der Fall: Spaltkeil, Rundling und Kantholz waren
// invertiert, Halbholz als einziges richtig.
function normiereUmlauf(punkte) {
  let flaeche2 = 0;
  for (let index = 0; index < punkte.length; index += 1) {
    const a = punkte[index], b = punkte[(index + 1) % punkte.length];
    flaeche2 += a[0] * b[1] - b[0] * a[1];
  }
  return flaeche2 < 0 ? punkte.slice().reverse() : punkte;
}

// Das Profil MUSS so breit und so dick sein, wie das Bauteil behauptet. Vorher
// reichte der Spaltkeil nur von -0,62 bis +0,94 Halbdicken - der Riegel war
// real 22 Prozent duenner als sein Nennmass, und im Stapel blieb genau diese
// Luft zwischen den Hoelzern. Nach der Normierung liegt die Unterkante exakt
// bei -dicke/2: das ist die Auflageflaeche.
function normiereMasse(punkte, breiteM, dickeM) {
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const [u, v] of punkte) { minU = Math.min(minU, u); maxU = Math.max(maxU, u); minV = Math.min(minV, v); maxV = Math.max(maxV, v); }
  const su = breiteM / Math.max(EPSILON, maxU - minU);
  const sv = dickeM / Math.max(EPSILON, maxV - minV);
  return punkte.map(([u, v]) => [(u - minU) * su - breiteM * 0.5, (v - minV) * sv - dickeM * 0.5]);
}

export function querschnitt(form, breiteM, dickeM, seed) {
  return normiereUmlauf(normiereMasse(querschnittRoh(form, breiteM, dickeM, seed), breiteM, dickeM));
}

function querschnittRoh(form, breiteM, dickeM, seed) {
  const asym = (hash01(seed * 17) - 0.5) * 0.22;
  const b = breiteM * 0.5, d = dickeM * 0.5;
  if (form === 'rundling') {
    const seiten = 8, radius = Math.max(b, d);
    return Array.from({ length: seiten }, (_, index) => {
      const winkel = (index / seiten) * Math.PI * 2;
      const rauheit = 1 + (hash01(seed * 31 + index * 19) - 0.5) * 0.16;
      return [Math.cos(winkel) * radius * rauheit, Math.sin(winkel) * radius * rauheit * (d / Math.max(EPSILON, radius) * 0.5 + 0.5)];
    });
  }
  if (form === 'kantholz') {
    const fase = Math.min(b, d) * 0.22;
    return [
      [-b + fase, -d], [b - fase, -d], [b, -d + fase],
      [b, d - fase], [b - fase, d], [-b + fase, d], [-b, d - fase], [-b, -d + fase]
    ];
  }
  if (form === 'halbholz') {
    const bogen = [];
    for (let index = 0; index <= 5; index += 1) {
      const winkel = Math.PI * (index / 5);
      const rauheit = 1 + (hash01(seed * 23 + index * 11) - 0.5) * 0.13;
      // Die Rundung reicht bis zur halben Dicke, nicht bis zur anderthalbfachen.
      bogen.push([-Math.cos(winkel) * b * rauheit, Math.sin(winkel) * d * 1.35 * rauheit - d * 0.35]);
    }
    return [[-b, -d * 0.72], ...bogen, [b, -d * 0.72]];
  }
  // spaltkeil: EINE glatte Spaltflaeche (die lange Unterkante), daran zwei
  // Bruchflaechen und oben die gewachsene, gerundete Ruecken- oder Rindenseite.
  // Der Keil ist absichtlich unsymmetrisch - ein symmetrisches Sechseck liest
  // sofort als gefraestes Profil.
  return [
    [-b, -d * (0.62 + asym * 0.5)],
    [b * (0.86 + asym * 0.3), -d],
    [b, -d * (0.1 - asym * 0.6)],
    [b * (0.58 - asym * 0.4), d * (0.94 + asym * 0.2)],
    [-b * (0.24 + asym * 0.5), d],
    [-b * (0.9 - asym * 0.2), d * (0.5 - asym * 0.4)]
  ];
}

// ---------------------------------------------------------------------------
// Ein Bauteil = ein Sweep. Kein Kaestchenstapel.
// ---------------------------------------------------------------------------

const laenge3 = vector => Math.hypot(vector.x, vector.y, vector.z);
const norm3 = vector => {
  const length = laenge3(vector) || 1;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
};
const kreuz = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

function bauteilRahmen(von, bis) {
  const vorwaerts = norm3({ x: bis.x - von.x, y: bis.y - von.y, z: bis.z - von.z });
  let seite = kreuz({ x: 0, y: 1, z: 0 }, vorwaerts);
  if (laenge3(seite) < 1e-5) seite = { x: 1, y: 0, z: 0 };
  seite = norm3(seite);
  const oben = norm3(kreuz(vorwaerts, seite));
  return { vorwaerts, seite, oben, laenge: laenge3({ x: bis.x - von.x, y: bis.y - von.y, z: bis.z - von.z }) };
}

// Verjuengung: gespaltenes Holz laeuft an den Enden leicht aus. Ein Zapfenriegel
// wird am Ende gezielt schmaler, damit er ins Loch geht.
function skalaBei(t, endSkala, verjuengungsLaenge) {
  if (t <= verjuengungsLaenge) return endSkala + (1 - endSkala) * (t / verjuengungsLaenge);
  if (t >= 1 - verjuengungsLaenge) return endSkala + (1 - endSkala) * ((1 - t) / verjuengungsLaenge);
  return 1;
}

function emitSweep(THREE, writer, teil, farbe, endFarbe) {
  const rahmen = bauteilRahmen(teil.von, teil.bis);
  if (rahmen.laenge < 0.02) return 0;
  const profil = querschnitt(teil.form || 'spaltkeil', teil.breiteM, teil.dickeM, teil.seed || 1);
  const bogen = teil.bogenM || 0;
  const ringZahl = Math.min(
    teil.maxRinge ?? 5,
    Math.abs(bogen) > 0.004 || Math.abs(teil.drallGrad || 0) > 6 ? 5 : 3
  );
  // Ein gespaltener Riegel laeuft am Ende NICHT spitz zu - er bricht ab. Die
  // frueheren 0,82 auf 18 Prozent der Laenge lasen als angespitzter Federkiel.
  const endSkala = teil.verjuengung ?? 0.93;
  const verjuengungsLaenge = teil.verjuengung ? 0.12 : 0.06;
  const drall = (teil.drallGrad || 0) * Math.PI / 180;

  const ringe = [];
  const uMeter = [0];
  for (let index = 1; index <= profil.length; index += 1) {
    const a = profil[index - 1], b = profil[index % profil.length];
    uMeter.push(uMeter[index - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }

  for (let ring = 0; ring < ringZahl; ring += 1) {
    const t = ring / (ringZahl - 1);
    const bogenAnteil = Math.sin(Math.PI * t) * bogen;
    const mitte = {
      x: teil.von.x + (teil.bis.x - teil.von.x) * t + rahmen.seite.x * bogenAnteil,
      y: teil.von.y + (teil.bis.y - teil.von.y) * t + rahmen.seite.y * bogenAnteil + rahmen.oben.y * bogenAnteil * 0.35,
      z: teil.von.z + (teil.bis.z - teil.von.z) * t + rahmen.seite.z * bogenAnteil
    };
    const skala = skalaBei(t, endSkala, verjuengungsLaenge);
    const winkel = drall * (t - 0.5);
    const cos = Math.cos(winkel), sin = Math.sin(winkel);
    ringe.push(profil.map(([u, v], vertex) => {
      const rauheit = 1 + (hash01((teil.seed || 1) * 67 + vertex * 19 + ring * 43) - 0.5) * 0.03;
      const du = (u * cos - v * sin) * skala * rauheit;
      const dv = (u * sin + v * cos) * skala * rauheit;
      return {
        x: mitte.x + rahmen.seite.x * du + rahmen.oben.x * dv,
        y: mitte.y + rahmen.seite.y * du + rahmen.oben.y * dv,
        z: mitte.z + rahmen.seite.z * du + rahmen.oben.z * dv
      };
    }));
  }

  let dreiecke = 0;
  for (let ring = 0; ring < ringZahl - 1; ring += 1) {
    const vA = (ring / (ringZahl - 1)) * rahmen.laenge, vB = ((ring + 1) / (ringZahl - 1)) * rahmen.laenge;
    for (let seite = 0; seite < profil.length; seite += 1) {
      const naechste = (seite + 1) % profil.length;
      const flaeche = farbe.clone().offsetHSL(0, 0, (hash01((teil.seed || 1) * 59 + seite * 17) - 0.5) * 0.075);
      // Reihenfolge so, dass die Flaechennormale nach AUSSEN zeigt. Geprueft
      // wird das nicht per Augenmass, sondern ueber das vorzeichenbehaftete
      // Volumen des einzelnen Bauteils (tools/test-wurmzaun.mjs).
      writer.addQuad(
        ringe[ring][seite], ringe[ring][naechste], ringe[ring + 1][naechste], ringe[ring + 1][seite], flaeche,
        [uMeter[seite], vA], [uMeter[seite + 1], vA], [uMeter[seite + 1], vB], [uMeter[seite], vB]
      );
      dreiecke += 2;
    }
  }

  // Spaltenden: die Kappe wird leicht aus der Ebene gekippt, sonst liest das Ende
  // wie ein Saegeschnitt. Historisch sind es gebrochene, schraege Enden.
  for (const [ringIndex, richtung] of [[0, -1], [ringZahl - 1, 1]]) {
    const ring = ringe[ringIndex];
    const mitte = ring.reduce((sum, punkt) => ({ x: sum.x + punkt.x / ring.length, y: sum.y + punkt.y / ring.length, z: sum.z + punkt.z / ring.length }), { x: 0, y: 0, z: 0 });
    // Ein gespaltenes Ende bricht ab, es laeuft nicht spitz zu. Der Versatz
    // der Kappenmitte bleibt darum klein - eine schraege Bruchflaeche, kein Federkiel.
    const kipp = (hash01((teil.seed || 1) * 89 + ringIndex * 7) - 0.45) * teil.breiteM * 0.09;
    const spitze = {
      x: mitte.x + rahmen.vorwaerts.x * kipp * richtung,
      y: mitte.y + rahmen.vorwaerts.y * kipp * richtung,
      z: mitte.z + rahmen.vorwaerts.z * kipp * richtung
    };
    for (let seite = 0; seite < profil.length; seite += 1) {
      const naechste = (seite + 1) % profil.length;
      if (richtung > 0) writer.addTriangle(ring[naechste], spitze, ring[seite], endFarbe, [uMeter[seite + 1], 0], [0, 0.02], [uMeter[seite], 0]);
      else writer.addTriangle(ring[seite], spitze, ring[naechste], endFarbe, [uMeter[seite], 0], [0, 0.02], [uMeter[seite + 1], 0]);
      dreiecke += 1;
    }
  }
  return dreiecke;
}

// Runde, leicht verjuengte Stange (Stake, Staur).
function emitRundstange(THREE, writer, von, bis, durchmesserM, farbe, endFarbe, seed, spitzeUnten = true) {
  const rahmen = bauteilRahmen(von, bis);
  if (rahmen.laenge < 0.03) return 0;
  const seiten = 7;
  const ringZahl = 3;
  const ringe = [];
  for (let ring = 0; ring < ringZahl; ring += 1) {
    const t = ring / (ringZahl - 1);
    const skala = (spitzeUnten ? clamp(0.32 + t * 2.4, 0.32, 1) : 1) * (1 - t * 0.16);
    const mitte = {
      x: von.x + (bis.x - von.x) * t,
      y: von.y + (bis.y - von.y) * t,
      z: von.z + (bis.z - von.z) * t
    };
    ringe.push(Array.from({ length: seiten }, (_, index) => {
      const winkel = (index / seiten) * Math.PI * 2;
      const rauheit = 1 + (hash01(seed * 31 + index * 19 + ring * 7) - 0.5) * 0.15;
      const radius = durchmesserM * 0.5 * skala * rauheit;
      return {
        x: mitte.x + rahmen.seite.x * Math.cos(winkel) * radius + rahmen.oben.x * Math.sin(winkel) * radius,
        y: mitte.y + rahmen.seite.y * Math.cos(winkel) * radius + rahmen.oben.y * Math.sin(winkel) * radius,
        z: mitte.z + rahmen.seite.z * Math.cos(winkel) * radius + rahmen.oben.z * Math.sin(winkel) * radius
      };
    }));
  }
  let dreiecke = 0;
  for (let ring = 0; ring < ringZahl - 1; ring += 1) {
    const vA = (ring / (ringZahl - 1)) * rahmen.laenge, vB = ((ring + 1) / (ringZahl - 1)) * rahmen.laenge;
    for (let seite = 0; seite < seiten; seite += 1) {
      const naechste = (seite + 1) % seiten;
      const flaeche = farbe.clone().offsetHSL(0, 0, (hash01(seed * 23 + seite * 7) - 0.5) * 0.07);
      writer.addQuad(ringe[ring][seite], ringe[ring][naechste], ringe[ring + 1][naechste], ringe[ring + 1][seite], flaeche,
        [seite * durchmesserM * 0.4, vA], [(seite + 1) * durchmesserM * 0.4, vA], [(seite + 1) * durchmesserM * 0.4, vB], [seite * durchmesserM * 0.4, vB]);
      dreiecke += 2;
    }
  }
  const kopf = ringe.at(-1);
  const kopfMitte = { x: bis.x, y: bis.y, z: bis.z };
  for (let seite = 0; seite < seiten; seite += 1) {
    writer.addTriangle(kopfMitte, kopf[seite], kopf[(seite + 1) % seiten], endFarbe);
    dreiecke += 1;
  }
  // Auch der eingegrabene Fuss wird geschlossen. Ein offener Koerper ist kein
  // Koerper - und wo das Gelaende einmal aufgeschnitten wird, sieht man hinein.
  const fuss = ringe[0];
  const fussMitte = { x: von.x, y: von.y, z: von.z };
  for (let seite = 0; seite < seiten; seite += 1) {
    writer.addTriangle(fussMitte, fuss[(seite + 1) % seiten], fuss[seite], farbe);
    dreiecke += 1;
  }
  return dreiecke;
}

// Achsparalleler Quader im lokalen Rahmen eines Pfostens.
function emitQuader(writer, mitte, tangente, normale, halbBreite, halbTiefe, vonY, bisY, farbe, uvSkala = 1) {
  const punkt = (sb, st, y) => ({
    x: mitte.x + tangente.x * sb * halbBreite + normale.x * st * halbTiefe,
    y,
    z: mitte.z + tangente.z * sb * halbBreite + normale.z * st * halbTiefe
  });
  const unten = [punkt(-1, -1, vonY), punkt(1, -1, vonY), punkt(1, 1, vonY), punkt(-1, 1, vonY)];
  const oben = [punkt(-1, -1, bisY), punkt(1, -1, bisY), punkt(1, 1, bisY), punkt(-1, 1, bisY)];
  const hoehe = bisY - vonY;
  for (let seite = 0; seite < 4; seite += 1) {
    const naechste = (seite + 1) % 4;
    const flaeche = farbe.clone().offsetHSL(0, 0, (seite % 2 === 0 ? 0.03 : -0.03));
    writer.addQuad(unten[seite], oben[seite], oben[naechste], unten[naechste], flaeche,
      [seite * halbBreite * uvSkala, 0], [seite * halbBreite * uvSkala, hoehe], [(seite + 1) * halbBreite * uvSkala, hoehe], [(seite + 1) * halbBreite * uvSkala, 0]);
  }
  writer.addQuad(oben[0], oben[1], oben[2], oben[3], farbe.clone().offsetHSL(0, -0.02, 0.07));
  writer.addQuad(unten[3], unten[2], unten[1], unten[0], farbe);
  return 12;
}

// Zapfenlochpfosten. Das Loch ist ein echtes Loch: an der Zapfenlage besteht der
// Pfosten aus zwei Wangen, dazwischen laeuft der Riegel hindurch. Kein CSG noetig.
function emitZapfenlochPfosten(THREE, writer, pfosten, farbe, endFarbe) {
  let dreiecke = 0;
  const halbBreite = pfosten.breiteM * 0.5;
  const halbTiefe = pfosten.tiefeM * 0.5;
  const baender = [...pfosten.zapfen]
    .map(zapfen => ({ von: zapfen.mitteY - zapfen.hoeheM * 0.5, bis: zapfen.mitteY + zapfen.hoeheM * 0.5, breiteM: zapfen.breiteM }))
    .sort((a, b) => a.von - b.von);
  let y = pfosten.fussY;
  for (const band of baender) {
    if (band.von > y) {
      dreiecke += emitQuader(writer, pfosten, pfosten.tangent, pfosten.normal, halbBreite, halbTiefe, y, band.von, farbe);
    }
    const wangenTiefe = Math.max(0.016, (pfosten.tiefeM - band.breiteM) * 0.5);
    for (const seite of [-1, 1]) {
      const versatz = (pfosten.tiefeM - wangenTiefe) * 0.5 * seite;
      const wangenMitte = { x: pfosten.x + pfosten.normal.x * versatz, z: pfosten.z + pfosten.normal.z * versatz };
      dreiecke += emitQuader(writer, wangenMitte, pfosten.tangent, pfosten.normal, halbBreite, wangenTiefe * 0.5, Math.max(y, band.von), band.bis, farbe.clone().offsetHSL(0, 0, -0.03));
    }
    y = Math.max(y, band.bis);
  }
  if (pfosten.kopfY > y) dreiecke += emitQuader(writer, pfosten, pfosten.tangent, pfosten.normal, halbBreite, halbTiefe, y, pfosten.kopfY - 0.035, farbe);
  // Abgeschraegter Kopf.
  const fase = 0.035;
  const kopfPunkt = (sb, st, yy) => ({
    x: pfosten.x + pfosten.tangent.x * sb * halbBreite + pfosten.normal.x * st * halbTiefe,
    y: yy,
    z: pfosten.z + pfosten.tangent.z * sb * halbBreite + pfosten.normal.z * st * halbTiefe
  });
  const unten = [kopfPunkt(-1, -1, pfosten.kopfY - fase), kopfPunkt(1, -1, pfosten.kopfY - fase), kopfPunkt(1, 1, pfosten.kopfY - fase), kopfPunkt(-1, 1, pfosten.kopfY - fase)];
  const oben = [kopfPunkt(-0.72, -0.72, pfosten.kopfY), kopfPunkt(0.72, -0.72, pfosten.kopfY), kopfPunkt(0.72, 0.72, pfosten.kopfY), kopfPunkt(-0.72, 0.72, pfosten.kopfY)];
  for (let seite = 0; seite < 4; seite += 1) {
    const naechste = (seite + 1) % 4;
    writer.addQuad(unten[seite], oben[seite], oben[naechste], unten[naechste], endFarbe);
    dreiecke += 2;
  }
  writer.addQuad(oben[0], oben[1], oben[2], oben[3], endFarbe.clone().offsetHSL(0, 0, 0.04));
  return dreiecke + 2;
}

// Feldstein unter der Ecke: unregelmaessige flache Platte, keine Kiste. Braucht
// die Ecke mehr Hoehe, als ein Stein hergibt, werden es MEHRERE Lagen - genau so
// wird auf dem Feld ausgeglichen. Ein 30-cm-Monolith waere ein Fundament, und ein
// Fundament hat der Wurmzaun gerade nicht.
const STEIN_LAGE_MAX_M = 0.115;

function emitStein(THREE, writer, stein, farbe) {
  const lagen = Math.max(1, Math.ceil(stein.hoeheM / STEIN_LAGE_MAX_M));
  const lagenHoehe = stein.hoeheM / lagen;
  const seiten = 7;
  let dreiecke = 0;
  for (let lage = 0; lage < lagen; lage += 1) {
    const streuung = hash01(stein.x * 91 + stein.z * 37 + lage * 53);
    const drehung = stein.drehung + (streuung - 0.5) * 1.4;
    const cos = Math.cos(drehung), sin = Math.sin(drehung);
    // Obere Lagen werden kleiner - der grosse Stein liegt unten.
    const groesse = 1 - lage * 0.13;
    const versatzX = (hash01(stein.x * 17 + lage * 29) - 0.5) * stein.breiteM * 0.18;
    const versatzZ = (hash01(stein.z * 23 + lage * 31) - 0.5) * stein.tiefeM * 0.18;
    const untenY = stein.grundY + lagenHoehe * lage - (lage === 0 ? 0.06 : 0.006);
    const obenY = stein.grundY + lagenHoehe * (lage + 1);
    const ring = anteil => Array.from({ length: seiten }, (_, index) => {
      const winkel = (index / seiten) * Math.PI * 2;
      const rauheit = 0.7 + hash01(stein.x * 13 + stein.z * 7 + index * 19 + lage * 41) * 0.58;
      const u = Math.cos(winkel) * stein.breiteM * 0.5 * rauheit * anteil * groesse;
      const v = Math.sin(winkel) * stein.tiefeM * 0.5 * rauheit * anteil * groesse;
      return { x: stein.x + versatzX + u * cos - v * sin, y: 0, z: stein.z + versatzZ + u * sin + v * cos };
    });
    const unten = ring(1).map(punkt => ({ ...punkt, y: untenY }));
    const oben = ring(0.88).map(punkt => ({ ...punkt, y: obenY }));
    const lagenFarbe = farbe.clone().offsetHSL(0, 0, (streuung - 0.5) * 0.14);
    for (let seite = 0; seite < seiten; seite += 1) {
      const naechste = (seite + 1) % seiten;
      writer.addQuad(unten[seite], oben[seite], oben[naechste], unten[naechste],
        lagenFarbe.clone().offsetHSL(0, 0, (hash01(seite * 31 + stein.x + lage) - 0.5) * 0.1));
      dreiecke += 2;
    }
    const mitte = { x: stein.x + versatzX, y: obenY, z: stein.z + versatzZ };
    for (let seite = 0; seite < seiten; seite += 1) {
      writer.addTriangle(mitte, oben[(seite + 1) % seiten], oben[seite], lagenFarbe.clone().offsetHSL(0, 0, 0.07));
      dreiecke += 1;
    }
    const fussMitte = { x: stein.x + versatzX, y: untenY, z: stein.z + versatzZ };
    for (let seite = 0; seite < seiten; seite += 1) {
      writer.addTriangle(fussMitte, unten[seite], unten[(seite + 1) % seiten], lagenFarbe);
      dreiecke += 1;
    }
  }
  return dreiecke;
}

// Weidenbindung: eine geschlossene Schlaufe um beide Pfaehle. Sie laeuft laengs
// der Normalen, weil das Pfahlpaar quer zur Achse steht.
function emitBindung(THREE, writer, bindung, farbe) {
  // Eine Weidenrute LIEGT AN. Die frühere Ellipse war fast doppelt so lang wie
  // das Pfahlpaar breit ist und schwebte als flaches Band daneben - im Nahbild
  // sah sie aus wie ein Papierstreifen. Richtig ist die Umschlingung: zwei
  // Halbkreise um die beiden Pfahlachsen, dazwischen zwei gerade Stuecke, die
  // ueber die eingelegten Stangen laufen.
  const halbAchse = bindung.halbAchseM ?? (bindung.halbLaengeM - bindung.radiusM);
  const rundung = bindung.radiusM;
  const halbkreisPunkte = 5;
  const bahn = [];
  const setze = (mitteLaengs, winkelVon, winkelBis) => {
    for (let index = 0; index <= halbkreisPunkte; index += 1) {
      const winkel = winkelVon + (winkelBis - winkelVon) * (index / halbkreisPunkte);
      const laengs = mitteLaengs + Math.cos(winkel) * rundung;
      const quer = Math.sin(winkel) * rundung;
      // Die Rute steigt beim Umschlingen leicht an - sie endet nicht dort, wo
      // sie begonnen hat, sondern verdrillt sich ueber sich selbst.
      const anteil = bahn.length;
      bahn.push({
        x: bindung.x + bindung.normal.x * laengs + bindung.tangent.x * quer,
        y: bindung.y + anteil * bindung.schnurM * 0.16 - bindung.schnurM,
        z: bindung.z + bindung.normal.z * laengs + bindung.tangent.z * quer
      });
    }
  };
  setze(halbAchse, -Math.PI * 0.5, Math.PI * 0.5);
  setze(-halbAchse, Math.PI * 0.5, Math.PI * 1.5);
  let dreiecke = 0;
  const halb = bindung.schnurM * 0.5;
  const punkte = bahn.length;
  for (let index = 0; index < punkte; index += 1) {
    const a = bahn[index], b = bahn[(index + 1) % punkte];
    const rahmen = bauteilRahmen(a, b);
    if (rahmen.laenge < 1e-4) continue;
    const ecken = (punkt, seite, oben) => ({
      x: punkt.x + rahmen.seite.x * seite * halb + rahmen.oben.x * oben * halb,
      y: punkt.y + rahmen.seite.y * seite * halb + rahmen.oben.y * oben * halb,
      z: punkt.z + rahmen.seite.z * seite * halb + rahmen.oben.z * oben * halb
    });
    const va = [ecken(a, -1, -1), ecken(a, 1, -1), ecken(a, 1, 1), ecken(a, -1, 1)];
    const vb = [ecken(b, -1, -1), ecken(b, 1, -1), ecken(b, 1, 1), ecken(b, -1, 1)];
    for (let seite = 0; seite < 4; seite += 1) {
      const naechste = (seite + 1) % 4;
      writer.addQuad(va[seite], va[naechste], vb[naechste], vb[seite], farbe);
      dreiecke += 2;
    }
  }
  return dreiecke;
}

// ---------------------------------------------------------------------------

export function kompiliereWurmzaun(THREE, plan) {
  const leer = {
    holzGeometrie: null, steinGeometrie: null, bindungGeometrie: null,
    metrics: { drawCalls: 0, triangles: 0, vertices: 0, bauteile: 0 }
  };
  if (!plan) return leer;

  const holz = createWriter(THREE);
  const stein = createWriter(THREE);
  const bindung = createWriter(THREE);
  const holzbild = plan.settings.holzbild;
  const seed = plan.settings.seed;

  let index = 0;
  for (const teil of [...plan.riegel, ...plan.stangen]) {
    const farbe = holzFarbe(THREE, holzbild, index, seed, teil.rolle === 'reiterriegel' ? 'pfosten' : 'riegel');
    const endFarbe = holzFarbe(THREE, holzbild, index, seed, 'ende');
    emitSweep(THREE, holz, teil, farbe, endFarbe);
    index += 1;
  }
  for (const stake of plan.staken) {
    const farbe = holzFarbe(THREE, holzbild, index, seed, 'pfosten');
    emitRundstange(THREE, holz, stake.von, stake.bis, stake.durchmesserM, farbe, holzFarbe(THREE, holzbild, index, seed, 'ende'), stake.seed, true);
    index += 1;
  }
  for (const pfahl of plan.pfaehle) {
    const farbe = holzFarbe(THREE, holzbild, index, seed, 'pfosten');
    const kopf = {
      x: pfahl.x + (pfahl.kopfVersatz?.x || 0),
      y: pfahl.kopfY,
      z: pfahl.z + (pfahl.kopfVersatz?.z || 0)
    };
    emitRundstange(THREE, holz, { x: pfahl.x, y: pfahl.fussY, z: pfahl.z }, kopf, pfahl.durchmesserM, farbe, holzFarbe(THREE, holzbild, index, seed, 'ende'), pfahl.seed, true);
    index += 1;
  }
  for (const pfosten of plan.pfosten) {
    const farbe = holzFarbe(THREE, holzbild, index, seed, 'pfosten');
    emitZapfenlochPfosten(THREE, holz, pfosten, farbe, holzFarbe(THREE, holzbild, index, seed, 'ende'));
    index += 1;
  }

  // Feldstein, kein Beton: waermerer Grundton und deutlich mehr Streuung von
  // Stein zu Stein.
  const steinFarbe = new THREE.Color('#a9a396');
  for (const eintrag of plan.steine) {
    emitStein(THREE, stein, eintrag, steinFarbe.clone().offsetHSL(
      (hash01(eintrag.x * 29 + eintrag.z * 11) - 0.5) * 0.06,
      (hash01(eintrag.x * 13) - 0.5) * 0.06,
      (hash01(eintrag.x * 17 + eintrag.z * 7) - 0.5) * 0.22));
  }

  const bindungFarbe = plan.settings.skigardBindung === 'draht' ? new THREE.Color('#8f9497') : new THREE.Color('#7d6a4a');
  for (const eintrag of plan.bindungen) {
    emitBindung(THREE, bindung, eintrag, bindungFarbe.clone().offsetHSL(0, 0, (hash01(eintrag.seed) - 0.5) * 0.1));
  }

  const holzGeometrie = holz.finish();
  const steinGeometrie = stein.finish();
  const bindungGeometrie = bindung.finish();
  const vertices = (holzGeometrie?.attributes.position.count || 0)
    + (steinGeometrie?.attributes.position.count || 0)
    + (bindungGeometrie?.attributes.position.count || 0);

  return {
    holzGeometrie,
    steinGeometrie,
    bindungGeometrie,
    metrics: Object.freeze({
      drawCalls: (holzGeometrie ? 1 : 0) + (steinGeometrie ? 1 : 0) + (bindungGeometrie ? 1 : 0),
      triangles: holz.triangleCount + stein.triangleCount + bindung.triangleCount,
      holzDreiecke: holz.triangleCount,
      steinDreiecke: stein.triangleCount,
      bindungDreiecke: bindung.triangleCount,
      vertices,
      bauteile: plan.diagnostics.bauteile,
      quality: 'demo-design'
    })
  };
}

// Material-independent copy of the ACTUAL emitted surfaces. Connection planning
// and independent mesh checks can use these, including taper, twist and caps.
// No nominal bounding capsule and no second approximation of the wood profile.
export function bauteilOberflaeche(teil, typ = 'riegel') {
  const triangles = [];
  const neutral = { clone() { return this; }, offsetHSL() { return this; } };
  const endNeutral = { endGrain:true, clone(){return this;},offsetHSL(){return this;} };
  const writer = {
    addTriangle(a, b, c, color, uvA = [0, 0], uvB = [0, 0], uvC = [0, 0]) {
      triangles.push({ points: [a, b, c].map(p => ({ ...p })), uv: [uvA, uvB, uvC],endGrain:!!color?.endGrain });
    },
    addQuad(a, b, c, d, color, ua, ub, uc, ud) {
      this.addTriangle(a, b, c, color, ua, ub, uc);
      this.addTriangle(a, c, d, color, ua, uc, ud);
    }
  };
  if (typ === 'stein') emitStein(null, writer, teil, neutral);
  else if (typ === 'stake') emitRundstange(null, writer, teil.von, teil.bis, teil.durchmesserM, neutral, endNeutral, teil.seed, true);
  else emitSweep(null, writer, teil, neutral, endNeutral);
  return triangles;
}
