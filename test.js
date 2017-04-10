const colors = require('colors');

const ericKlossEntries = {
  '1976soundrecordi33014libr_djvu': 0,
  '1977musicindexja33151libr_djvu': 0,
  '1977musicindexju33151libr_djvu': 0,
  '1977musicjanjune33152libr_djvu': 0,
  '1977musicjulydec33152libr_djvu': 0,
  '1977soundrecordi33114libr_djvu': 0,
  'catalogofco1966320512lib_djvu': 1,
  'catalogofco1966320512libr_djvu': 1,
  'catalogofco1967321512lib_djvu': 1,
  'catalogofco1967321512libr_djvu': 4,
  'catalogofco1968322512lib_djvu': 4,
  'catalogofco1968322512libr_djvu': 4,
  'catalogofco1969323512lib_djvu': 3,
  'catalogofco1969323512libr_djvu': 6,
  'catalogofco1970324512lib_djvu': 0,
  'catalogofco1970324512libr_djvu': 0,
  'catalogofco1971325512li_djvu': 3,
  'catalogofco1971325512lib_djvu': 0,
  'catalogofco1972326512libr_djvu': 0,
  'catalogofco1972326512unse_djvu': 6
};
const spawn = require('child_process').spawn;
const searchScript = spawn('node', [
  'search.js',
  '--term',
  'Eric Kloss',
  '--min_year',
  '1966',
  '--max_year',
  '1978'
]);

var output = '';

searchScript.stdout.on('data', data => {
  data = data.toString();
  console.log(data);
  output += data;
});

searchScript.stderr.on('data', data => {
  console.log(`error: ${data}`);
});

searchScript.on('close', code => {
  var results = eval((output.match(/Results:\n\n([\s\S]+)/) || [])[1] || '[]');
  // test occurances
  if (results.length === undefined) {
    throw Error(colors.yellow('Results not an array'));
  }
  var resultsOccurancesMap = {};
  results.forEach(result => {
    var fileName = (result.book || '').split('/').pop().replace('.txt', '');
    if (ericKlossEntries[fileName] !== undefined) {
      if (ericKlossEntries[fileName] === result.entries.length) {
        console.log(colors.green(`Occurances accurate for ${fileName}`));
      } else {
        throw Error(colors.red(`Occurances do not match for ${fileName}. ${ericKlossEntries[fileName]} known occurances vs ${result.entries.length} entries`));
      }
    }
  });
});
