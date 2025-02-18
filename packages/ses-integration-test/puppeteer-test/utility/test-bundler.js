/* global __dirname */

import puppeteer from 'puppeteer';
import test from 'tape-promise/tape';

import path from 'path';

const runBrowserTests = async (t, indexFile) => {
  const browser = await puppeteer.launch({
    // debug:
    // { headless: false }
  });

  let numTests;
  let numPass;

  const page = await browser.newPage();

  const done = new Promise((resolve, reject) => {
    page.on('pageerror', reject);

    page.on('console', msg => {
      console.log('>>> ', msg.text());
      if (msg.text().includes('# tests')) {
        [numTests] = msg
          .text()
          .split(' ')
          .slice(-1);
      }
      if (msg.text().includes('# pass')) {
        [numPass] = msg
          .text()
          .split(' ')
          .slice(-1);
      }
      if (msg.text().includes('# fail')) {
        reject(new Error(`At least one test failed for ${indexFile}`));
      }
      if (msg.text().includes('# ok')) {
        resolve();
      }
    });
  });

  try {
    await Promise.race([
      done,
      page.goto(`file:${path.join(__dirname, indexFile)}`),
    ]);

    await done;
  } finally {
    await browser.close();
  }

  if (numTests === undefined) {
    t.fail('No test results reported');
  }

  return { numTests, numPass };
};

const testBundler = (bundlerName, indexFile) => {
  test(`SES works with ${bundlerName}`, t => {
    runBrowserTests(t, indexFile)
      .then(({ numTests, numPass }) => {
        t.notEqual(numTests, undefined);
        t.equal(numTests, numPass);
      })
      .catch(e => t.fail(`Unexpected exception ${e}`))
      .finally(() => t.end());
  });
};

export default testBundler;
