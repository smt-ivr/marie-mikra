// Paths in the system. They come from the admin settings ("כתובות במערכת"),
// delivered by the server after sign-in – the same addresses the original site uses.
import { authState } from './auth.js';

export const DEFAULTS = {
  active_test_path: 'ivr2:/1/1/1/ExaminationAmericanLogOK.ymgr',
  points_report_path: 'ivr2:/Points/Split/points_total.ymgr',
  previous_tests_path: 'ivr2:/מבחנים-קודמים',
};

const p = (key, fallback) => {
  const v = authState.paths?.[key];
  return v ? `ivr2:/${v}` : fallback;
};

export const PATHS = {
  get testLockExt() { return p('exam_ext', 'ivr2:/1/1'); },
  get testLockIni() { return `${p('exam_ext', 'ivr2:/1/1')}/ext.ini`; },
  get pointsIni() { return `${p('points_folder', 'ivr2:/Points')}/Split/points_total.ini`; },
  get pointsSplitDir() { return `${p('points_folder', 'ivr2:/Points')}/Split`; },
  get pointsArchiveBase() { return p('points_folder', 'ivr2:/Points'); },
  get pointsArchiveTarget() { return p('points_folder', 'ivr2:/Points'); },
  get studentsIni() { return p('students_file', 'ivr2:/EnterID/ListAllInformation.ini'); },
  get timeIni() { return p('times_file', 'ivr2:/ext.ini'); },
  get passwordLog() { return `${p('logs_folder', 'ivr2:/Log')}/LogPassword.ini`; },
  get enterIdLog() { return `${p('logs_folder', 'ivr2:/Log')}/LogEnterID.ymgr`; },
  get importSources() {
    return [
      { label: 'מבחנים קודמים', path: p('archive_folder', 'ivr2:/מבחנים-קודמים') },
      { label: 'מבחנים קודמים (מקור נוסף)', path: p('import_source', 'ivr2:/מבחנים-קודמים-תשפה') },
    ];
  },
  tzintukListId: '2',
  excludedDids: ['0775024359'],
};

export const settings = {
  get activeTestPath() { return p('active_test', DEFAULTS.active_test_path); },
  get previousTestsPath() { return p('archive_folder', DEFAULTS.previous_tests_path); },
};
