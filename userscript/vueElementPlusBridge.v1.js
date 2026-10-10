/* Vue's UMD build creates a lexical Vue binding inside userscript managers.
 * Element Plus's UMD build reads globalThis.Vue instead. This file runs between
 * their @require entries so both libraries use the same Vue instance.
 */
globalThis.Vue = Vue;
