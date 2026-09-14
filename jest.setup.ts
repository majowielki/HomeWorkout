import { configure } from '@testing-library/react-native';

// The first render in a suite pays for transforming every imported module;
// on a cold cache (CI) that alone can exceed RNTL's 1 s default and make
// `findBy*` fail spuriously. 5 s is generous but only ever waited when
// something is actually wrong.
configure({ asyncUtilTimeout: 5000 });
