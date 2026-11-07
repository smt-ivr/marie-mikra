// File paths are kept in this browser under the SAME keys the old version uses.
// (Sign-in details are no longer stored in the browser: the server holds them.)
import { storageGet, storageSet } from './util.js';

export const DEFAULTS = {
  active_test_path: 'ivr2:/1/1/1/ExaminationAmericanLogOK.ymgr',
  points_report_path: 'ivr2:/Points/Split/points_total.ymgr',
  previous_tests_path: 'ivr2:/מבחנים-קודמים',
};

// Fixed paths used by the system (same as the old version).
export const PATHS = {
  testLockExt: 'ivr2:/1/1',
  testLockIni: 'ivr2:/1/1/ext.ini',
  pointsIni: 'ivr2:/Points/Split/points_total.ini',
  pointsSplitDir: 'ivr2:/Points/Split',
  pointsArchiveBase: 'ivr2:/Points',
  pointsArchiveTarget: 'ivr2:Points',
  studentsIni: 'ivr2:/EnterID/ListAllInformation.ini',
  timeIni: 'ivr2:/ext.ini',
  passwordLog: 'ivr2:/Log/LogPassword.ini',
  enterIdLog: 'ivr2:/Log/LogEnterID.ymgr',
  importSources: [
    { label: 'מבחנים קודמים', path: 'ivr2:/מבחנים-קודמים' },
    { label: 'מבחנים קודמים תשפ"ה', path: 'ivr2:/מבחנים-קודמים-תשפה' },
  ],
  tzintukListId: '2',
  excludedDids: ['0775024359'],
};

export const settings = {
  get activeTestPath() { return storageGet('active_test_path') || DEFAULTS.active_test_path; },
  set activeTestPath(v) { storageSet('active_test_path', v || null); },
  get pointsReportPath() { return storageGet('points_report_path') || DEFAULTS.points_report_path; },
  set pointsReportPath(v) { storageSet('points_report_path', v || null); },
  get previousTestsPath() { return storageGet('previous_tests_path') || DEFAULTS.previous_tests_path; },
  set previousTestsPath(v) { storageSet('previous_tests_path', v || null); },
  resetPaths() {
    ['active_test_path', 'points_report_path', 'previous_tests_path'].forEach((k) => storageSet(k, null));
  },
};
