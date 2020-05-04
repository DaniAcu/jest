/**
 * Copyright (c) Facebook, Inc. and its affiliates. All Rights Reserved.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'graceful-fs';
import {skipSuiteOnWindows} from '@jest/test-utils';
import {cleanup, writeFiles} from '../Utils';
import {runContinuous} from '../runJest';

// Until https://github.com/nodejs/node/issues/33227 is solved somehow
skipSuiteOnWindows();

const DIR = path.resolve(os.tmpdir(), 'watch_mode_no_access');

const sleep = (time: number) =>
  new Promise(resolve => setTimeout(resolve, time));

beforeEach(() => cleanup(DIR));
afterAll(() => cleanup(DIR));

const setupFiles = () => {
  writeFiles(DIR, {
    '__tests__/foo.test.js': `
      const foo = require('../foo');
      test('foo', () => { expect(typeof foo).toBe('number'); });
    `,
    'foo.js': `
      module.exports = 0;
    `,
    'package.json': JSON.stringify({
      jest: {},
    }),
  });
};

let testRun: ReturnType<typeof runContinuous>;

afterEach(async () => {
  if (testRun) {
    await testRun.end();
  }
});

test('does not re-run tests when only access time is modified', async () => {
  setupFiles();

  testRun = runContinuous(DIR, ['--watchAll', '--no-watchman']);

  const testCompletedRE = /Ran all test suites./g;
  const numberOfTestRuns = (stderr: string): number => {
    const matches = stderr.match(testCompletedRE);
    return matches ? matches.length : 0;
  };

  // First run
  await testRun.waitUntil(({stderr}) => numberOfTestRuns(stderr) === 1);

  // Should re-run the test
  const modulePath = path.join(DIR, 'foo.js');
  const stat = fs.lstatSync(modulePath);
  fs.utimesSync(modulePath, stat.atime.getTime(), stat.mtime.getTime());

  await testRun.waitUntil(({stderr}) => numberOfTestRuns(stderr) === 2);

  // Should NOT re-run the test
  const fakeATime = 1541723621;
  fs.utimesSync(modulePath, fakeATime, stat.mtime.getTime());
  await sleep(3000);
  expect(numberOfTestRuns(testRun.getCurrentOutput().stderr)).toBe(2);

  // Should re-run the test
  fs.writeFileSync(modulePath, 'module.exports = 1;', {encoding: 'utf-8'});
  await testRun.waitUntil(({stderr}) => numberOfTestRuns(stderr) === 3);
});