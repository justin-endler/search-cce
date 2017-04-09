'use strict';
const fs = require('fs');
const nconf = require('nconf');
const async = require('async');
const cheerio = require('cheerio');
const request = require('request');
const config = require('./package.json').config;

nconf.argv();

var term = nconf.get('term');
var threeLineTerm;
var twoLineTerm;
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

              if (term.test(getBookTxtBody)) {
                let result = {
                  year,
                  book: getBookTxtResponse.request.href,
                  entries: getBookTxtBody.match(threeLineTerm)
                };
                if (!result.entries) {
                  result.entries = getBookTxtBody.match(twoLineTerm);
                }
                results.push(result);
              }
              searchHalfTxtCb();
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
