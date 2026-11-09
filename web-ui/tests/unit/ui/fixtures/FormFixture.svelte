<!-- A whole form built from the form components, for tests/unit/ui/forms.test.ts -->
<script lang="ts">
	import { createForm, type FormOptions } from '../../../../src/lib/ui/form.svelte.ts';
	import Field from '../../../../src/lib/ui/Field.svelte';
	import Input from '../../../../src/lib/ui/Input.svelte';
	import Checkbox from '../../../../src/lib/ui/Checkbox.svelte';
	import ShowWhen, { showWhenControl } from '../../../../src/lib/ui/ShowWhen.svelte';
	import SaveBar from '../../../../src/lib/ui/SaveBar.svelte';
	import ChoiceList from '../../../../src/lib/ui/ChoiceList.svelte';

	export interface Values {
		name: string;
		port: number;
		proxy: boolean;
		proxyHost: string;
		mode: 'approval' | 'open';
	}

	interface Props {
		submit: FormOptions<Values>['submit'];
		validate?: FormOptions<Values>['validate'];
	}

	let { submit, validate }: Props = $props();

	// The props are read once: a form is made once per page
	// svelte-ignore state_referenced_locally
	export const form = createForm<Values>({
		initial: { name: 'Reception PC', port: 3389, proxy: false, proxyHost: '', mode: 'approval' },
		validate,
		submit
	});
</script>

<form id={form.id} onsubmit={form.onsubmit} novalidate>
	<Field label="Name" hint="How it appears in the device list." error={form.errors.name}>
		{#snippet children(f)}<Input {...f} bind:value={form.values.name} />{/snippet}
	</Field>
	<Field label="Port" width="short" effect="After a restart" effectTone="restart" error={form.errors.port}>
		{#snippet children(f)}<Input {...f} type="number" bind:value={form.values.port} />{/snippet}
	</Field>
	<Checkbox
		label="Use a proxy"
		hint="Connections go through another server."
		bind:checked={form.values.proxy}
		{...showWhenControl('proxy-fields', form.values.proxy)}
	/>
	<ShowWhen id="proxy-fields" when={form.values.proxy}>
		<Field label="Proxy host" width="host" error={form.errors.proxyHost}>
			{#snippet children(f)}<Input {...f} bind:value={form.values.proxyHost} />{/snippet}
		</Field>
	</ShowWhen>
	<ChoiceList
		label="Enrollment mode"
		choices={[
			{ value: 'approval', title: 'Approval', description: 'New devices wait until someone approves them.' },
			{ value: 'open', title: 'Open', description: 'Any device can join without approval.' }
		]}
		bind:value={form.values.mode}
	/>
	<SaveBar {form} label="Save" />
</form>
