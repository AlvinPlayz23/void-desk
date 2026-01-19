import { FileNode, useFileStore } from "@/stores/fileStore";
import { useFileSystem } from "@/hooks/useFileSystem";
import { FileItem } from "./FileItem";

interface FileTreeProps {
    nodes: FileNode[];
    depth: number;
}

export function FileTree({ nodes, depth }: FileTreeProps) {
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

    return (
        <div className="animate-fade-in">
            {nodes.map((node) => (
                <div key={node.path}>
                    <FileItem
                        node={node}
                        depth={depth}
                        onClick={() => handleClick(node)}
                    />
                    {node.isDir && node.isExpanded && node.children && (
                        <FileTree nodes={node.children} depth={depth + 1} />
                    )}
                </div>
            ))}
        </div>
    );
}
