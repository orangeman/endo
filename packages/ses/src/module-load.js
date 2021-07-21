// For brevity, in this file, as in module-link.js, the term "moduleRecord"
// without qualification means "module compartment record".
// This is a super-set of the "static module record", that is reusable between
// compartments with different hooks.
// The "module compartment record" captures the compartment and overlays the
// module's "imports" with the more specific "resolvedImports" as inferred from
// the particular compartment's "resolveHook".

import {
  ReferenceError,
  TypeError,
  arrayMap,
  create,
  freeze,
  mapGet,
  mapHas,
  mapSet,
  promiseAll,
  promiseCatch,
  values,
  weakmapGet,
} from './commons.js';
import { assert } from './error/assert.js';

const { details: d, quote: q } = assert;

// `makeAlias` constructs compartment specifier tuples for the `aliases`
// private field of compartments.
// These aliases allow a compartment to alias an internal module specifier to a
// module specifier in an external compartment, and also to create internal
// aliases.
// Both are facilitated by the moduleMap Compartment constructor option.
export const makeAlias = (compartment, specifier) =>
  freeze({
    compartment,
    specifier,
  });

// `resolveAll` pre-computes resolutions of all imports within the compartment
// in which a module was loaded.
const resolveAll = (imports, resolveHook, fullReferrerSpecifier) => {
  const resolvedImports = create(null);
  for (const importSpecifier of imports) {
    const fullSpecifier = resolveHook(importSpecifier, fullReferrerSpecifier);
    resolvedImports[importSpecifier] = fullSpecifier;
  }
  return freeze(resolvedImports);
};

const loadRecord = async (
  compartmentPrivateFields,
  moduleAliases,
  compartment,
  moduleSpecifier,
  staticModuleRecord,
) => {
  const { resolveHook, moduleRecords } = weakmapGet(
    compartmentPrivateFields,
    compartment,
  );

  // resolve all imports relative to this referrer module.
  const resolvedImports = resolveAll(
    staticModuleRecord.imports,
    resolveHook,
    moduleSpecifier,
  );
  const moduleRecord = freeze({
    compartment,
    staticModuleRecord,
    moduleSpecifier,
    resolvedImports,
  });

  // Memoize.
  mapSet(moduleRecords, moduleSpecifier, moduleRecord);

  // Await all dependencies to load, recursively.
  await promiseAll(
    arrayMap(values(resolvedImports), fullSpecifier =>
      // Behold: recursion.
      // eslint-disable-next-line no-use-before-define
      load(compartmentPrivateFields, moduleAliases, compartment, fullSpecifier),
    ),
  );

  return moduleRecord;
};

const loadWithoutErrorAnnotation = async (
  compartmentPrivateFields,
  moduleAliases,
  compartment,
  moduleSpecifier,
) => {
  const { importHook, moduleMap, moduleMapHook, moduleRecords } = weakmapGet(
    compartmentPrivateFields,
    compartment,
  );

  // Follow moduleMap, or moduleMapHook if present.
  let aliasNamespace = moduleMap[moduleSpecifier];
  if (aliasNamespace === undefined && moduleMapHook !== undefined) {
    aliasNamespace = moduleMapHook(moduleSpecifier);
  }
  if (typeof aliasNamespace === 'string') {
    // eslint-disable-next-line @endo/no-polymorphic-call
    assert.fail(
      d`Cannot map module ${q(moduleSpecifier)} to ${q(
        aliasNamespace,
      )} in parent compartment, not yet implemented`,
      TypeError,
    );
  } else if (aliasNamespace !== undefined) {
    const alias = weakmapGet(moduleAliases, aliasNamespace);
    if (alias === undefined) {
      // eslint-disable-next-line @endo/no-polymorphic-call
      assert.fail(
        d`Cannot map module ${q(
          moduleSpecifier,
        )} because the value is not a module exports namespace, or is from another realm`,
        ReferenceError,
      );
    }
    // Behold: recursion.
    // eslint-disable-next-line no-use-before-define
    const aliasRecord = await load(
      compartmentPrivateFields,
      moduleAliases,
      alias.compartment,
      alias.specifier,
    );
    // Memoize.
    mapSet(moduleRecords, moduleSpecifier, aliasRecord);
    return aliasRecord;
  }

  // Memoize.
  if (mapHas(moduleRecords, moduleSpecifier)) {
    return mapGet(moduleRecords, moduleSpecifier);
  }

  const staticModuleRecord = await importHook(moduleSpecifier);

  if (staticModuleRecord === null || typeof staticModuleRecord !== 'object') {
    // eslint-disable-next-line @endo/no-polymorphic-call
    assert.fail(
      d`importHook must return a promise for an object, for module ${q(
        moduleSpecifier,
      )} in compartment ${q(compartment.name)}`,
    );
  }

  if (staticModuleRecord.record !== undefined) {
    const {
      compartment: aliasCompartment = compartment,
      specifier: aliasSpecifier = moduleSpecifier,
      record: aliasModuleRecord,
    } = staticModuleRecord;

    const aliasRecord = await loadRecord(
      compartmentPrivateFields,
      moduleAliases,
      aliasCompartment,
      aliasSpecifier,
      aliasModuleRecord,
    );
    // Memoize by aliased specifier.
    mapSet(moduleRecords, moduleSpecifier, aliasRecord);
    return aliasRecord;
  }

  return loadRecord(
    compartmentPrivateFields,
    moduleAliases,
    compartment,
    moduleSpecifier,
    staticModuleRecord,
  );
};

// `load` asynchronously loads `StaticModuleRecords` and creates a complete
// graph of `ModuleCompartmentRecords`.
// The module records refer to each other by a reference to the dependency's
// compartment and the specifier of the module within its own compartment.
// This graph is then ready to be synchronously linked and executed.
export const load = async (
  compartmentPrivateFields,
  moduleAliases,
  compartment,
  moduleSpecifier,
) => {
  return promiseCatch(
    loadWithoutErrorAnnotation(
      compartmentPrivateFields,
      moduleAliases,
      compartment,
      moduleSpecifier,
    ),
    error => {
      const { name } = weakmapGet(compartmentPrivateFields, compartment);
      // eslint-disable-next-line @endo/no-polymorphic-call
      assert.note(
        error,
        d`${error.message}, loading ${q(moduleSpecifier)} in compartment ${q(
          name,
        )}`,
      );
      throw error;
    },
  );
};
