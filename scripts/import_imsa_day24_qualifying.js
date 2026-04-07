const fs = require("fs");

const INPUT = `POS\tST POS\tCAR NO\tCLASS\tCLASS POS\tDRIVERS\tTEAM/CAR/SPONSOR\tNO LAPS\tFASTEST LAP\tSTATUS
1\t0\t31\t\t1\t
Connor Zilisch
Frederik Vesti
Earl Bamber
Jack Aitken
Cadillac Whelen
Cadillac V-Series.R
6\t1:33.939\tRunning
2\t0\t93\t\t2\t
Kaku Ohta
Alex Palou
Nick Yelloly
Rengervander Zande
Acura Meyer Shank Racing w/Curb Agajanian
Acura ARX-06
6\t1:34.041\tRunning
3\t0\t40\t\t3\t
Louis Deletraz
Colton Herta
Jordan Taylor
Cadillac Wayne Taylor Racing
Cadillac V-Series.R
8\t1:34.069\tRunning
4\t0\t7\t\t4\t
Felipe Nasr
Laurin Heinrich
Julien Andlauer
Porsche Penske Motorsport
Porsche 963
7\t1:34.183\tRunning
5\t0\t60\t\t5\t
Tom Blomqvist
Scott Dixon
Colin Braun
AJ Allmendinger
Acura Meyer Shank Racing w/Curb Agajanian
Acura ARX-06
6\t1:34.235\tRunning
6\t0\t6\t\t6\t
Kevin Estre
Laurens Vanthoor
Matt Campbell
Porsche Penske Motorsport
Porsche 963
8\t1:34.395\tRunning
7\t0\t10\t\t7\t
Will Stevens
Filipe Albuquerque
Ricky Taylor
Cadillac Wayne Taylor Racing
Cadillac V-Series.R
8\t1:34.513\tRunning
8\t0\t5\t\t8\t
Kaylen Frederick
Nico Pino
Tijmenvander Helm
JDC-Miller MotorSports
Porsche 963
8\t1:34.617\tRunning
9\t0\t24\t\t9\t
Rene Rast
Sheldonvander Linde
Dries Vanthoor
Robin Frijns
BMW M Team WRT
BMW M Hybrid V8
7\t1:34.892\tRunning
10\t0\t25\t\t10\t
Philipp Eng
Marco Wittmann
Raffaele Marciello
Kevin Magnussen
BMW M Team WRT
BMW M Hybrid V8
9\t1:35.347\tRunning
11\t0\t23\t\t11\t
RomanDe Angelis
Alex Riberas
Marco Sorensen
Ross Gunn
ASTON MARTIN THOR Team
Aston Martin Valkyrie
6\t1:35.382\tRunning
12\t0\t43\t\t1\t
Bijoy Garg
AntonioFelixda Costa
Tom Dillmann
Jeremy Clarke
Inter Europol Competition
ORECA LMP2 07
8\t1:39.952\tRunning
13\t0\t99\t\t2\t
Jonny Edgar
Christian Rasmussen
PJ Hyett
Dane Cameron
AO Racing
ORECA LMP2 07
8\t1:39.960\tRunning
14\t0\t22\t\t3\t
Daniel Goldburg
PaulDi Resta
Grégoire Saucy
Rasmus Lindh
United Autosports USA
ORECA LMP2 07
9\t1:40.096\tRunning
15\t0\t52\t\t4\t
Misha Goikhberg
Parker Thompson
Harry Tincknell
Ben Keating
Bryan Herta Autosport with PR1/Mathiasen
ORECA LMP2 07
9\t1:40.542\tRunning
16\t0\t11\t\t5\t
DavidHeinemeier Hansson
Charles Milesi
Tobi Lutke
Mathias Beche
TDS Racing
ORECA LMP2 07
9\t1:40.628\tRunning
17\t0\t343\t\t6\t
Nick Cassidy
Jakub Smiechowski
George Kolovos
Nolan Siegel
Inter Europol Competition
ORECA LMP2 07
10\t1:40.834\tRunning
18\t0\t18\t\t7\t
Logan Sargeant
Ferdinand Habsburg
Naveen Rao
Jacob Abel
Era Motorsport
ORECA LMP2 07
9\t1:40.987\tRunning
19\t0\t04\t\t8\t
Toby Sowery
Alex Quinn
Malthe Jakobsen
George Kurtz
Crowdstrike Racing by APR
ORECA LMP2 07
10\t1:41.021\tRunning
20\t0\t73\t\t9\t
ManuelEspirito Santo
Pietro Fittipaldi
Enzo Fittipaldi
Chris Cumming
Pratt Miller Motorsports
ORECA LMP2 07
9\t1:41.185\tRunning
21\t0\t2\t\t10\t
Ben Hanley
Phil Fayer
Mikkel Jensen
Hunter McElrea
United Autosports USA
ORECA LMP2 07
10\t1:41.279\tRunning
22\t0\t8\t\t11\t
Sebastien Bourdais
Kyffin Simpson
Sebastian Alvarez
John Farano
Tower Motorsports
ORECA LMP2 07
9\t1:41.563\tRunning
23\t0\t83\t\t12\t
Dylan Murry
Francois Perrodo
Nicklas Nielsen
Matthieu Vaxiviere
Af Corse Usa
ORECA LMP2 07
10\t1:41.576\tRunning
24\t0\t37\t\t13\t
JobVan Uitert
Seth Lucas
Oliver Jarvis
Jon Field
Intersport Racing
ORECA LMP2 07
10\t1:42.131\tRunning
25\t0\t3\t\t1\t
Marvin Kirchhöfer
Alexander Sims
Antonio Garcia
Corvette Racing by Pratt Miller Motorsports
Chevrolet Corvette Z06 GT3.R
7\t1:45.106\tRunning
26\t0\t27\t\t1\t
Tom Gamble
Mattia Drudi
Zacharie Robichon
Dudu Barrichello
Heart of Racing Team
Aston Martin Vantage GT3 Evo
6\t1:45.113\tRunning
27\t0\t57\t\t2\t
Russell Ward
Indy Dontje
Philip Ellis
Lucas Auer
WINWARD RACING
Mercedes-AMG GT3
6\t1:45.187\tRunning
28\t0\t96\t\t3\t
Robby Foley
Patrick Gallagher
Francis Selldorff
Jens Klingmann
Turner Motorsport
BMW M4 GT3 EVO
6\t1:45.265\tRunning
29\t0\t36\t\t4\t
Salih Yoluc
Charlie Eastwood
Mason Filippi
Scott McLaughlin
DXDT Racing
Chevrolet Corvette Z06 GT3.R
8\t1:45.274\tRunning
30\t0\t1\t\t2\t
Max Hesse
ConnorDe Phillippi
Neil Verhagen
Dan Harper
Paul Miller Racing
BMW M4 GT3 EVO
8\t1:45.276\tRunning
31\t0\t19\t\t5\t
ValentinHasse Clot
Roryvander Steur
Carl Bennett
Sébastien Baud
van der Steur Racing
Aston Martin Vantage GT3 Evo
6\t1:45.381\tRunning
32\t0\t59\t\t3\t
Juri Vips
Max Esterson
Dean MacDonald
Nikita Johnson
RLL Team McLaren
McLaren 720S GT3 EVO
7\t1:45.425\tRunning
33\t0\t75\t\t4\t
Kenny Habul
Maro Engel
Will Power
Chaz Mostert
75 Express
Mercedes-AMG GT3
5\t1:45.448\tRunning
34\t0\t033\t\t5\t
Riccardo Agostini
Alessio Rovera
Miguel Molina
James Calado
Triarsi Competizione
Ferrari 296 GT3 EVO
6\t1:45.506\tRunning
35\t0\t21\t\t6\t
LilouWadoux Ducellier
Tommaso Mosca
Antonio Fuoco
Simon Mann
Af Corse Usa
Ferrari 296 GT3 EVO
5\t1:45.527\tRunning
36\t0\t81\t\t7\t
Giacomo Altoè
Casper Stevenson
Henrik Hedman
Matteo Cairoli
DragonSpeed
Chevrolet Corvette Z06 GT3.R
7\t1:45.539\tRunning
37\t0\t65\t\t6\t
Sebastian Priaulx
Frederic Vervisch
Christopher Mies
Ford Racing
Ford Mustang GT3
5\t1:45.595\tRunning
38\t0\t80\t\t8\t
Ralf Aron
James Roe
Scott Andrews
Lin Hodenius
Lone Star Racing
Mercedes-AMG GT3
7\t1:45.620\tRunning
39\t0\t69\t\t7\t
Maximilian Goetz
Anthony Bartone
Jules Gounon
Fabian Schiller
GetSpeed
Mercedes-AMG GT3
6\t1:45.633\tRunning
40\t0\t4\t\t8\t
Nico Varrone
Tommy Milner
Nicky Catsburg
Corvette Racing by Pratt Miller Motorsports
Chevrolet Corvette Z06 GT3.R
6\t1:45.646\tRunning
41\t0\t62\t\t9\t
AlessandroPier Guidi
Davide Rigon
Daniel Serra
Risi Competizione
Ferrari 296 GT3 EVO
8\t1:45.662\tRunning
42\t0\t48\t\t10\t
Scott Noble
Jason Hart
Luca Stolz
Maxime Martin
WINWARD RACING
Mercedes-AMG GT3
6\t1:45.693\tRunning
43\t0\t70\t\t9\t
David Fumanelli
Frederik Schandorff
Brendan Iribe
Ollie Millroy
Inception Racing
Ferrari 296 GT3 EVO
7\t1:45.837\tRunning
44\t0\t9\t\t11\t
Mirko Bortolotti
James Hinchcliffe
Sandy Mitchell
Andrea Caldarelli
Pfaff Motorsports
Lamborghini Temerario GT3
6\t1:45.959\tRunning
45\t0\t120\t\t10\t
Callum Ilott
Elliott Skeer
Adam Adelson
Tom Sargent
Wright Motorsports
Porsche 911 GT3 R (992)
7\t1:45.997\tRunning
46\t0\t14\t\t12\t
Ben Barnicoat
Kyle Kirkwood
Jack Hawksworth
Vasser Sullivan Racing
Lexus RC F GT3
6\t1:46.029\tRunning
47\t0\t64\t\t13\t
Mike Rockenfeller
Dennis Olsen
Ben Barker
Ford Racing
Ford Mustang GT3
5\t1:46.029\tRunning
48\t0\t911\t\t14\t
Ayhancan Guven
Riccardo Feller
Klaus Bachler
Thomas Preining
Manthey
Porsche 911 GT3 R (992)
8\t1:46.034\tRunning
49\t0\t77\t\t15\t
Alessio Picariello
Harry King
Nick Tandy
AO Racing
Porsche 911 GT3 R (992)
8\t1:46.242\tRunning
50\t0\t023\t\t11\t
Yifei Ye
Kenton Koch
Robert Megennis
Onofrio Triarsi
Triarsi Competizione
Ferrari 296 GT3 EVO
8\t1:46.290\tRunning
51\t0\t45\t\t12\t
Graham Doyle
Marcus Ericsson
Danny Formal
Trent Hindman
Wayne Taylor Racing
Lamborghini Huracan GT3 EVO2
7\t1:46.292\tRunning
52\t0\t34\t\t13\t
Manny Franco
Albert Costa
Thierry Vermeulen
Lorenzo Patrese
Conquest Racing
Ferrari 296 GT3 EVO
6\t1:46.556\tRunning
53\t0\t12\t\t14\t
Benjamin Pedersen
Frankie Montecalvo
Aaron Telitz
Esteban Masson
Vasser Sullivan Racing
Lexus RC F GT3
7\t1:46.636\tRunning
54\t0\t44\t\t15\t
Spencer Pumpelly
Madison Snow
Nicki Thiim
John Potter
Magnus Racing
Aston Martin Vantage GT3 Evo
8\t1:46.851\tRunning
55\t0\t13\t\t16\t
Ben Green
Lars Kern
Matthew Bell
Orey Fidani
13 Autosport
Chevrolet Corvette Z06 GT3.R
9\t1:47.051\tRunning
56\t0\t66\t\t17\t
Till Bechtolsheimer
Jake Walker
Corey Lewis
Joey Hand
Gradient Racing
Ford Mustang GT3
6\t1:47.121\tRunning
57\t0\t912\t\t18\t
Richard Lietz
Riccardo Pera
Morris Schuring
Ryan Hardwick
Manthey 1St Phorm
Porsche 911 GT3 R (992)
8\t1:47.414\tRunning
58\t0\t123\t\t19\t
Peter Ludwig
Ryan Yardley
Dave Musial
DaveMusial Jr.
Muehlner Motorsports America, LLC
Porsche 911 GT3 R (992)
8\t1:47.682\tRunning
59\t0\t28\t\t20\t
Dillon Machavern
Eric Zitza
Jan Heylen
Sven Müller
Rs1
Porsche 911 GT3 R (992)
9\t1:47.686\tRunning
60\t0\t16\t\t21\t
Romain Grosjean
Jenson Altzman
Sheena Monk
Felipe Fraga
Myers Riley Motorsports
Ford Mustang GT3
6\t1:48.220\tRunning`;

function isStart(line) {
  return /^\d+\t\d+\t/.test(line);
}

function parseBlock(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  while (i < lines.length && !isStart(lines[i])) i++;

  const recs = [];
  while (i < lines.length) {
    const first = lines[i];
    if (!isStart(first)) {
      i++;
      continue;
    }
    const parts = first.split("\t");
    const pos = parts[0];
    const carNo = parts[2];
    const classPos = parts[4];
    i++;

    const chunk = [];
    while (i < lines.length && !isStart(lines[i])) {
      chunk.push(lines[i]);
      i++;
    }

    const nonEmpty = chunk.map((s) => String(s).trim()).filter(Boolean);
    const statsIdx = nonEmpty.findIndex((s) => /^\d+\t\d+:\d\d\.\d+\t/.test(s));
    if (statsIdx < 0) throw new Error(`No stats line for car ${carNo} pos ${pos}`);

    const [laps, lap, ...statusParts] = nonEmpty[statsIdx].split("\t");
    const status = statusParts.join("\t");

    const before = nonEmpty.slice(0, statsIdx);
    if (before.length < 3) throw new Error(`Not enough lines before stats for car ${carNo}`);

    const car = before[before.length - 1];
    const team = before[before.length - 2];
    const drivers = before.slice(0, before.length - 2);

    recs.push({ pos, carNo, classPos, drivers, team, car, laps, lap, status });
  }
  return recs;
}

function main() {
  const parsed = parseBlock(INPUT);
  console.log(`Parsed ${parsed.length} rows`);

  const evPath = "C:/Users/stepa/Documents/TGA/data/events/IMSA/2026/imsa_2026_1.json";
  const ev = JSON.parse(fs.readFileSync(evPath, "utf8"));

  const classByNo = {};
  for (const e of ev.entry_list || []) {
    const n = String(e.number || "").trim();
    const cls = String(e.class || "").trim();
    if (n && cls) classByNo[n] = cls;
  }
  for (const k of Object.keys(classByNo)) {
    const kInt = String(parseInt(k, 10));
    if (kInt === k) classByNo[kInt] = classByNo[k];
  }

  const headers = [
    "POS",
    "CAR NO",
    "CLASS",
    "CLASS POS",
    "DRIVERS",
    "TEAM/CAR/SPONSOR",
    "NO LAPS",
    "FASTEST LAP",
    "STATUS",
  ];

  const rows = parsed.map((r) => {
    const key = String(r.carNo).trim();
    const cls = classByNo[key] || classByNo[String(parseInt(key, 10))] || "";
    const drivers = r.drivers.join("; ");
    const tc = `${r.team} / ${r.car}`;
    return [
      String(r.pos),
      String(r.carNo),
      cls,
      String(r.classPos),
      drivers,
      tc,
      String(r.laps),
      String(r.lap),
      String(r.status),
    ];
  });

  const missing = rows.filter((r) => !r[2]).map((r) => r[1]);
  if (missing.length) console.warn("Missing CLASS for:", missing.join(", "));

  ev.tables = ev.tables || {};
  ev.tables.qualifying = { headers, rows };

  fs.writeFileSync(evPath, JSON.stringify(ev, null, 2) + "\n", "utf8");
  console.log("Wrote tables.qualifying to imsa_2026_1.json");
}

main();

