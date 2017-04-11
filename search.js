'use strict';
const fs = require('fs');
const nconf = require('nconf');
const async = require('async');
const cheerio = require('cheerio');
const request = require('request');
const readline = require('readline');
const Readable = require('stream').Readable;

const config = require('./package.json').config;

nconf.argv();

var term = nconf.get('term');
var threeLineTerm;
var twoLineTerm;
var fourLineTerm;
var results = [];

async.waterfall([
  validate,
  years,
  perYear
], function (error) {
  if (error) {
    return console.log(error);
  }
  // sort by year
  results = results.sort(function (a, b) {
    if (a.year === b.year) {
      return 0;
    }
    return a.year < b.year ? -1 : 1;
  });
  console.log('\nResults:\n');
  console.log(results);
});

// Ensure there's a search term and save it
// Ensure there's a directory for caching text file responses
function validate (callback) {
  console.info("term:", term); // @test
  if (!term) {
    return callback('Search term required');
  }
  // @todo validate that year args are not outside of limits
  if (!fs.existsSync('books')) {
    fs.mkdir('books');
  }

  threeLineTerm = new RegExp(`.*?${term}.*?\n.+?\n.+`, 'gi');
  fourLineTerm = new RegExp(`.+?\n\n.*?${term}.*?\n.+`, 'gi');
  twoLineTerm = new RegExp(`.*?${term}.*?\n.+`, 'gi');
  term = new RegExp(term, 'i');

  callback();
}

// Request the landing page containing links for each year
function years (callback) {
  request({
    uri: `http://${config.request.host}/cce/`,
    headers: config.request.headers
  }, callback);
}


function perYear (yearsResponse, yearsBody, perYearCallback) {
  // Establish years to be searched
  var minYear = parseInt(nconf.get('min_year') || config.years.min, 10);
  var maxYear = parseInt(nconf.get('max_year') || config.years.max, 10);

  if (maxYear < minYear) {
    return perYearCallback('Upper year limit must be greater or equal to lower year limit.');
  }

  var years = range(minYear, maxYear + 1);

  var years$ = cheerio.load(yearsBody);
  var $ul = years$('ul');

  async.each(years, function (year, eachCb) {
    async.waterfall([
      // Request landing page for each year
      function getYearLanding (getYearLandingCb) {
        var file = $ul.find(`li a:contains("${year}")`).attr('href');
        request({
          uri: `http://${config.request.host}/cce/${file}`,
          headers: config.request.headers
        }, getYearLandingCb);
      },
      function getCategories (getYearLandingResponse, getYearLandingBody, getCategoriesCb) {
        var yearLanding$ = cheerio.load(getYearLandingBody);
        var categoryHeadings = [];
        // attempt Music category
        var $musicH2 = yearLanding$('h2#music');
        if (!$musicH2.length) {
          $musicH2 = yearLanding$('a[name=music]').closest('h2');
        }
        if ($musicH2.length) {
          categoryHeadings.push($musicH2);
        }
        // attempt Sound Recordings category
        var $soundRecordingsH2 = yearLanding$('a[name=sound]').closest('h2');
        if ($soundRecordingsH2.length) {
          categoryHeadings.push($soundRecordingsH2);
        }
        getCategoriesCb(null, categoryHeadings);
      },
      function getCategoryBooks (categoryHeadings, getCategoryBooksCb) {
        var books = [];
        categoryHeadings.forEach(function ($categoryHeading) {
          $categoryHeading.next('ul').children('li').each(function () {
            books.push(years$(this).find('a').first().attr('href'));
          });
        });

        async.each(books, function (book, eachBookCb) {
          var bookFileName;
          var bookIsCached = false;
          async.waterfall([
            function getBookLanding (getBookLandingCb) {
              request({
                uri: book
              }, getBookLandingCb);
            },
            function getBookTxt (getBookLandingResponse, getBookLandingBody, getBookTxtCb) {
              var bookLanding$ = cheerio.load(getBookLandingBody);
              var txtPath = bookLanding$('.download-pill[href*=".txt"]').attr('href') || '';
              bookFileName = txtPath.split('/').pop();

              // check for cached version
              if (fs.existsSync(`books/${bookFileName}`)) {
                console.log(`loading ${year}, book ${bookFileName} from cache`);
                bookIsCached = true;
                fs.readFile(`books/${bookFileName}`, 'utf8', function (error, data) {
                  if (error) {
                    return getBookTxtCb(error);
                  }
                  var book$ = cheerio.load(data);
                  var response = {
                    request: {
                      href: (data.match(/[\n](.+)/) || [])[1] || ''
                    }
                  };
                  getBookTxtCb(null, response, data);
                });
              } else {
                console.log(`requesting ${year}, book ${bookFileName}`);
                request({
                  uri: `https://${getBookLandingResponse.request.uri.host}${txtPath}`
                }, getBookTxtCb);
              }
            },
            function searchHalfTxt (getBookTxtResponse, getBookTxtBody, searchHalfTxtCb) {
              // cache the txt file
              if (!bookIsCached) {
                let book$ = cheerio.load(getBookTxtBody);
                // record the title and link
                getBookTxtBody = `${book$('title').text()}\n${getBookTxtResponse.request.href}\n${book$('pre').text()}`;
                fs.writeFile(`books/${bookFileName}`, getBookTxtBody);
              }
              // create a stream to search line by line
              var getBookTxtBodyStream = new Readable();
              getBookTxtBodyStream.push(getBookTxtBody);
              getBookTxtBodyStream.push(null); // @todo necessary?
              var lineReader = readline.createInterface({
                input: getBookTxtBodyStream
              });

              var lines = ['', '', '', ''];
              var result = {
                year,
                book: getBookTxtResponse.request.href,
                entries: []
              };

              lineReader.on('line', function (line) {
                lines.push(line);
                lines.shift();
                var validEntry = validateEntry(lines);
                if (validEntry) {
                  result.entries.push(validEntry);
                }
              });
              lineReader.on('close', function () {
                if (result.entries.length) {
                  results.push(result);
                }
                searchHalfTxtCb();
              });

              // if (term.test(getBookTxtBody)) {
              //   let result = {
              //     year,
              //     book: getBookTxtResponse.request.href,
              //     entries: getBookTxtBody.match(threeLineTerm) || []
              //   };
              //   (getBookTxtBody.match(twoLineTerm) || []).forEach(match => {
              //     if (result.entries.indexOf(match) === -1) {
              //       result.entries.push(match);
              //     }
              //   });
              //   (getBookTxtBody.match(fourLineTerm) || []).forEach(match => {
              //     if (result.entries.indexOf(match) === -1) {
              //       result.entries.push(match);
              //     }
              //   });
              //   // @todo entries are now bloated from above logic. need better regexes

              //   results.push(result);
              // } // @test regex version
              //searchHalfTxtCb();
            }
          ], eachBookCb);
        }, getCategoryBooksCb);
      }
    ], eachCb);
  }, perYearCallback);
}

function range (min, max, inclusive) {
  min = parseInt(min, 10) || 0;
  max = parseInt(max, 10) || 0;
  var numbers = [];
  for (let i = min; i < max; i++) {
    numbers.push(i);
  }
  if (max && inclusive) {
    numbers.push(max);
  }
  return numbers;
}

function validateEntry(lines) {
  // contains the term
  if (!term.test(lines.join())) {
    return false;
  }
  // 4-line format
  // first line is present and does not end with an entry id
  // second line is not present (remove it)
  // third line contains the term
  // fourth line ends with an entry id
  if (
    (lines[0] && !endsWithEntryId(lines[0])) &&
    lines[1] === '' &&
    term.test(lines[2]) &&
    endsWithEntryId(lines[3])
  ) {
    return `${lines[0].trim()} ${lines[2].trim()} ${lines[3].trim()}`;
  }
  // 4-line format
  // first line contains term
  // second line is not present (remove it)
  // third line is present
  // fourth line ends with an entry id
  if (
    term.test(lines[0]) &&
    lines[1] === '' &&
    lines[2] &&
    endsWithEntryId(lines[3])
  ) {
    return `${lines[0].trim()} ${lines[2].trim()} ${lines[3].trim()}`;
  }

  // 3-line format (variation of above)
  // first line is present and does not end with an entry id
  // second line contains the term
  // third line ends with an entry id
  if (
    (lines[0] && !endsWithEntryId(lines[0])) &&
    term.test(lines[1]) &&
    endsWithEntryId(lines[2])
  ) {
    return `${lines[0].trim()} ${lines[1].trim()} ${lines[2].trim()}`;
  }
  // 3-line format
  // first line contains the term
  // second line is present
  // third line ends with an entry id
  // (remove fourth line)
  if (
    term.test(lines[0]) &&
    lines[1] &&
    endsWithEntryId(lines[2])
  ) {
    return `${lines[0].trim()} ${lines[1].trim()} ${lines[2].trim()}`;
  }

  // 2-line format
  // first line not present (remove)
  // second line contains term
  // third line present
  // fourth line not present (remove)
  // if (
  //   !lines[0] &&
  //   term.test(lines[1]) &&
  //   lines[2] &&
  //   !lines[3]
  // ) {
  //   return `${lines[1].trim()} ${lines[2].trim()}`;
  // }

  return false;
}

function endsWithEntryId(str) {
  str = (str || '').trim();
  // @todo there can be letters in the id so this is failing
  return str && (/\d{3}\s*\./.test(str) || /\d{3}\s*-/.test(str));
}
