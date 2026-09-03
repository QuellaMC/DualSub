import { configure } from '@testing-library/dom';

// CI runners share cores across the whole suite; a React update that lands
// in milliseconds locally can wait longer than the library's one-second
// default there. One margin for every UI test instead of per-test bumps.
configure({ asyncUtilTimeout: 2500 });
