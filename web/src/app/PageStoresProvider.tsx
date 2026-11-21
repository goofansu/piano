import { DraftFileView } from "@features/library/web/DraftDialogs";
import { CatalogsContext } from "@features/models/web/useCatalogs";
import { DraftsContext } from "@features/sessions/web/composer/useDrafts";
import { QuestionRepliesContext } from "@features/sessions/web/dialogs/useQuestionReplies";
import {
  type LibraryFile,
  RenderLibraryFile,
} from "@features/sessions/web/transcript/LibraryFileView";
import { workspaceFile } from "@features/workspace/web/files/fileApi";
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
