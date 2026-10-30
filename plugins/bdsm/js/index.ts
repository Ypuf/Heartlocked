import { getModules } from '@valenced/modules/finders'
import { withProps } from '@valenced/modules/finders/filters'
import { instead } from '@valenced/patcher'
import { AppState } from 'react-native'

interface Effect {
	created_at: number
	expires_at: number | null
	details: Record<string, any>
}

let effects: Record<string, Effect> = {}

function getEffect(name: string): Effect | undefined {
	const effect = effects[name]
	if (!effect) return
	if (effect.expires_at !== null && effect.expires_at * 1000 <= Date.now())
		return
	return effect
}

function overwrite(content: unknown): string | undefined {
	const details = getEffect('overwrite')?.details
	if (!details || typeof content !== 'string' || !content.trim()) return

	if (typeof details.text === 'string') return details.text

	const words: string[] =
		Array.isArray(details.words) && details.words.length
			? details.words.map(String)
			: ['mf', 'mn']
	const count = content.trim().split(/\s+/).length
	return Array.from(
		{ length: count },
		() => words[Math.floor(Math.random() * words.length)],
	).join(' ')
}

const GAGGED_ROUTES: Array<[method: string, path: RegExp]> = [
	['post', /^\/channels\/\d+\/messages\/?$/],
	['patch', /^\/channels\/\d+\/messages\/\d+\/?$/],
	['post', /^\/channels\/\d+\/threads\/?$/],
]

function requestPath(request: unknown): string {
	const url =
		typeof request === 'string' ? request : (request as { url?: string })?.url
	return String(url ?? '')
		.replace(/^https?:\/\/[^/]+/, '')
		.replace(/^\/api\/v\d+/, '')
		.split('?')[0]!
}

export default plugin({
	start({ cleanup }) {
		let UserStore: any
		cleanup(
			getModules(
				withProps<any>('getCurrentUser', 'getUser'),
				store => {
					if (!UserStore || store.getName?.() === 'UserStore') {
						UserStore = store
						refresh()
					}
				},
				{ max: 10 },
			),
		)

		let refreshing = false

		async function refresh() {
			const me = UserStore?.getCurrentUser()
			if (!me || refreshing) return

			refreshing = true
			const controller = new AbortController()
			const timeout = setTimeout(() => controller.abort(), 10000)
			try {
				const res = await fetch(`https://bdsm.jpuf.xyz/users/${me.id}`, {
					signal: controller.signal,
				})
				if (res.ok) effects = await res.json()
			} catch (e) {
				console.warn('[bdsm] could not reach server', e)
			} finally {
				clearTimeout(timeout)
				refreshing = false
			}
		}

		refresh()
		const interval = setInterval(refresh, 15000)
		cleanup(() => clearInterval(interval))

		const appState = AppState.addEventListener('change', state => {
			if (state === 'active') refresh()
		})
		cleanup(() => appState.remove())
		cleanup(() => {
			effects = {}
		})

		cleanup(
			getModules(withProps<any>('sendMessage', 'editMessage'), MessageActions =>
				patchMessageActions(MessageActions),
			),
		)
		cleanup(
			getModules(withProps<any>('getAPIBaseURL', 'setRequestPatch'), HTTP =>
				patchHTTP(HTTP),
			),
		)

		function patchMessageActions(MessageActions: any) {
			const notify = (channelId: string, text: string) => {
				try {
					MessageActions.sendBotMessage(channelId, text)
				} catch (e) {
					console.warn('[bdsm] failed to show notice', e)
				}
			}

			cleanup(
				instead(MessageActions, 'sendMessage', (args, original) => {
					const [channelId, message] = args
					if (getEffect('gag')) {
						notify(channelId, 'Dumb mutt, don\'t try to speak.')
						return Promise.resolve()
					}

					const replaced = overwrite(message?.content)
					if (replaced !== undefined) args[1] = { ...message, content: replaced }

					return original(...args)
				}),
			)

			cleanup(
				instead(MessageActions, 'sendStickers', (args, original) => {
					if (!getEffect('gag')) return original(...args)
					notify(args[0], 'You can\'t speak puppy~')
					return Promise.resolve()
				}),
			)

			cleanup(
				instead(MessageActions, 'editMessage', (args, original) => {
					if (getEffect('gag')) {
						notify(args[0], 'Don\'t try editing your messages~')
						try {
							MessageActions.endEditMessage(args[0])
						} catch {}
						return Promise.resolve()
					}

					const replaced = overwrite(args[2]?.content)
					if (replaced !== undefined) args[2] = { ...args[2], content: replaced }

					return original(...args)
				}),
			)
		}

		function patchHTTP(HTTP: any) {
			for (const target of new Set([HTTP, HTTP.HTTP].filter(Boolean))) {
				for (const method of ['post', 'patch']) {
					cleanup(
						instead(target, method, (args, original) => {
							const path = requestPath(args[0])
							const blocked =
								getEffect('gag') &&
								GAGGED_ROUTES.some(([m, re]) => m === method && re.test(path))
							if (!blocked) return original(...args)

							const err: any = new Error('You\'re the defect for a reason.')
							err.status = 403
							err.body = { message: err.message, code: 50013 }
							return Promise.reject(err)
						}),
					)
				}
			}
		}
	},
})
