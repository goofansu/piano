import { DraftFileView } from "@features/library/web/browser";
import { CatalogsContext } from "@features/models/web/browser";
import {
  DraftsContext,
  QuestionRepliesContext,
  type LibraryFile,
  RenderLibraryFile,
} from "@features/sessions/web/browser";
import { workspaceFile } from "@features/workspace/web/browser";
import type { ReactNode } from "react";
import { MarkdownFileReader } from "@/shared/markdown/useMarkdownImages";
import type { PageStores } from "./pageStores.ts";

const renderLibraryFile = (file: LibraryFile) => <DraftFileView {...file} />;

export function PageStoresProvider({
  value,
  children,
}: {
  value: PageStores;
  children: ReactNode;
}) {
  return (
    <DraftsContext value={value.drafts}>
      <QuestionRepliesContext value={value.questions}>
        <CatalogsContext value={value.catalogs}>
          <MarkdownFileReader value={workspaceFile}>
            <RenderLibraryFile value={renderLibraryFile}>{children}</RenderLibraryFile>
          </MarkdownFileReader>
        </CatalogsContext>
      </QuestionRepliesContext>
    </DraftsContext>
  );
}
