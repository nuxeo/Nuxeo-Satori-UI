/** @internal Presentation rows for the template shared by the principal and document pickers. */
export interface NxsPickerItem<T> {
  readonly value: T;
  readonly key: string;
  readonly label: string;
}

/** @internal An offered choice adds its icon and detail to the selected item's presentation. */
export interface NxsPickerOption<T> extends NxsPickerItem<T> {
  readonly detail: string;
  readonly detailKey?: string;
  readonly icon?: string;
  readonly documentType?: string;
}
