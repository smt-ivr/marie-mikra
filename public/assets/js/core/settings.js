// Settings live in localStorage under the SAME keys the old version uses,
// so switching between the new and the old version keeps the connection.
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
  get token() { return storageGet('api_token', '') || ''; },
  set token(v) { storageSet('api_token', v || null); },
  get username() { return storageGet('username', '') || ''; },
  set username(v) { storageSet('username', v || null); },
  get password() { return storageGet('password', '') || ''; },
  set password(v) { storageSet('password', v || null); },
  get activeTestPath() { return storageGet('active_test_path') || DEFAULTS.active_test_path; },
  set activeTestPath(v) { storageSet('active_test_path', v || null); },
  get pointsReportPath() { return storageGet('points_report_path') || DEFAULTS.points_report_path; },
  set pointsReportPath(v) { storageSet('points_report_path', v || null); },
  get previousTestsPath() { return storageGet('previous_tests_path') || DEFAULTS.previous_tests_path; },
  set previousTestsPath(v) { storageSet('previous_tests_path', v || null); },

  reset() {
    ['api_token', 'username', 'password', 'active_test_path', 'points_report_path', 'previous_tests_path']
      .forEach((k) => storageSet(k, null));
  },
};

/** Same behaviour as the old version: ?token= / ?username= / ?password= in the URL
 *  are saved and then removed from the address bar. Returns a message or null. */
export function absorbUrlParams() {
  const params = new URLSearchParams(location.search);
  const saved = [];
  const token = params.get('Token') || params.get('token');
  if (token) { settings.token = token; saved.push('טוקן'); }
  if (params.get('username')) { settings.username = params.get('username'); saved.push('מספר מערכת'); }
  if (params.get('password')) { settings.password = params.get('password'); saved.push('סיסמה'); }
  if (!saved.length) return null;
  history.replaceState(null, '', location.pathname + location.hash);
  return `ההגדרות הבאות נשמרו: ${saved.join(', ')}`;
}
