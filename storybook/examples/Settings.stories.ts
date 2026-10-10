import type { Meta, StoryObj } from '@storybook/vue3'
import SettingsDemo from './SettingsDemo.vue'
const meta = { title: 'Examples/Settings', component: SettingsDemo, tags: ['autodocs'] } satisfies Meta<typeof SettingsDemo>
export default meta
export const Reading: StoryObj<typeof meta> = { name: '设置组件组合' }
