/*---------------------------------------------------------------
 * What a thing keeps on disk beside the profile: a script a key runs, a
 * program it launches. Actions declare theirs in shared/config.ts and
 * widgets in shared/widgets/registry.ts, each in a table covering every kind,
 * so a new kind does not compile until it says whether it keeps files.
 *
 * An exported profile walks those tables rather than a list of its own: it
 * carries the files it can, and rewrites their paths when it is imported, so
 * nothing has to be remembered here when a kind is added.
 *--------------------------------------------------------------*/

export interface KeptFiles<T> {
    /** The paths it uses. */
    paths(value: T): string[];
    /** The same, with each of its paths through `moved`. */
    moved(value: T, moved: (path: string) => string): T;
    /**
     * Whether an exported profile carries the file itself. A program is
     * installed where it is installed, so only its path travels.
     */
    carried: boolean;
}

/** A file a profile keeps: where it is, and whether it travels with it. */
export interface KeptFile {
    path: string;
    carried: boolean;
}
