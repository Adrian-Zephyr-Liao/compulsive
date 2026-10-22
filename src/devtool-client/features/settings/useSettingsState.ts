import { Form } from "antd";
import { useEffect, useState } from "react";
import type { DoctorCheck, ManagerConfig } from "../../../types.js";

export type ConfigFormValues = Pick<ManagerConfig, "rootDir" | "workspaceRoot" | "scanRoots">;

// Keep these controllers in the settings shell so child-route changes retain drafts and results.
export function useStorageSettings(config: ManagerConfig) {
  const [form] = Form.useForm<ConfigFormValues>();
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    form.setFieldsValue(config);
    setDirty(false);
  }, [config, form]);
  return {
    form,
    dirty,
    onDirtyChange: setDirty,
    onReset: () => {
      form.setFieldsValue(config);
      setDirty(false);
    },
  };
}

export function useDoctor(onRunDoctor: () => Promise<DoctorCheck[]>) {
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>();
  const [doctorCheckedAt, setDoctorCheckedAt] = useState<Date>();
  async function runDoctor(): Promise<void> {
    setDoctorRunning(true);
    try {
      setDoctorChecks(await onRunDoctor());
      setDoctorCheckedAt(new Date());
    } catch {
      // The app-level notification reports the transport or doctor failure.
    } finally {
      setDoctorRunning(false);
    }
  }

  return { doctorRunning, doctorChecks, doctorCheckedAt, runDoctor };
}
