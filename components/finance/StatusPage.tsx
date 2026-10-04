"use client";

import BackendStatus from "./BackendStatus";
import PageHeader from "./PageHeader";
import { useWorkspace } from "./workspace";

export default function StatusPage() {
  const { capabilities } = useWorkspace();

  return (
    <>
      <PageHeader title="Status" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-4 pb-16 pt-10 sm:px-8 sm:pt-14">
          <BackendStatus capabilities={capabilities} />
        </div>
      </div>
    </>
  );
}
