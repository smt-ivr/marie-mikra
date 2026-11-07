// Fixed paths and defaults. Sign-in details are never stored in the browser.
import { authState } from './auth.js';

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

// Paths are set by the master in the admin panel and delivered by the server at sign-in.
export const settings = {
  get activeTestPath() { return authState.paths?.activeTestPath || DEFAULTS.active_test_path; },
  get previousTestsPath() { return authState.paths?.previousTestsPath || DEFAULTS.previous_tests_path; },
};
