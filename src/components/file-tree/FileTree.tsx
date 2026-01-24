import { FileNode, useFileStore } from "@/stores/fileStore";
import { useFileSystem } from "@/hooks/useFileSystem";
import { FileItem } from "./FileItem";

interface FileTreeProps {
    nodes: FileNode[];
    depth: number;
    rootPath?: string;
}

export function FileTree({ nodes, depth, rootPath }: FileTreeProps) {
    const { toggleFolder } = useFileStore();
    const { openFileInEditor } = useFileSystem();

    const handleClick = async (node: FileNode) => {
        if (node.isDir) {
            toggleFolder(node.path);
        } else {
            // Open file with real content from disk
            await openFileInEditor(node.path, node.name);
        }
    };

    // Prevent drag events from bubbling to parent (root drop zone) when over file items
    const handleDragOver = (_e: React.DragEvent) => {
        // Let events bubble up if not over a specific item
        // The individual FileItems will stop propagation when appropriate
    };

    return (
        <div
            className="animate-fade-in file-tree-container"
            onDragOver={handleDragOver}
        >
            {nodes.map((node) => (
                <div key={node.path}>
                    <FileItem
                        node={node}
                        depth={depth}
                        onClick={() => handleClick(node)}
                    />
                    {node.isDir && node.isExpanded && node.children && (
                        <FileTree nodes={node.children} depth={depth + 1} rootPath={rootPath} />
                    )}
                </div>
            ))}
        </div>
    );
}
