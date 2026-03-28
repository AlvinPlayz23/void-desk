export function normalizePath(path: string) {
    return path.replace(/\//g, "\\").replace(/^([A-Z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);
}

export function pathsEqual(left: string | null | undefined, right: string | null | undefined) {
    if (!left || !right) return false;
    return normalizePath(left) === normalizePath(right);
}
