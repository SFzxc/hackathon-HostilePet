/**
 * Curated Vietnamese lines, grouped by escalation level and site bucket.
 *
 * These are **fallback copy**, not the pet's voice: `docs/tone.md` §1 decided the line is
 * generated from the persona prompt, and §7 keeps a small curated set for when the model is
 * unreachable. Until a provider is configured, the fake provider draws from here and every
 * turn it produces is stamped `source: 'fallback'` — a stand-in line is never presented as
 * generated copy.
 *
 * House rules for anything added here (`docs/tone.md` §4): one line, ≤ 160 characters, punches
 * at the action and the timing rather than the person, no medical claims, no profanity, and no
 * numerals — a line with no number can never be an ungrounded number.
 */
export type SiteBucket = 'social' | 'shopping' | 'other'

export const FALLBACK_LINES: Record<1 | 2 | 3, Record<SiteBucket, readonly string[]>> = {
  1: {
    social: [
      'Lướt tiếp đi. Cái deadline kia chắc tự biết lo cho nó.',
      'Tab này mở lâu hơn cả cái việc ông đang trốn.',
      'Video sau sẽ hay hơn. Nghe quen không?',
      'Ông ghé qua cho vui, hay định ở luôn?'
    ],
    shopping: [
      'Xem cho đã mắt đi. Mai lại quên ngay ấy mà.',
      'Cái giỏ hàng không biết tự trả tiền đâu.',
      'Ông đang so giá hay đang tự thuyết phục?',
      'Thêm vào giỏ cũng là một cách tiêu tiền đấy.'
    ],
    other: [
      'Ở đây lâu thế? Tôi tưởng ông đang bận.',
      'Tôi vẫn đang nhìn màn hình. Ông thì đang ở đâu?',
      'Ừ, cứ tiếp đi. Tôi rảnh mà.',
      'Có vẻ ông tìm được chỗ trốn rồi.'
    ]
  },
  2: {
    social: [
      'Tôi bắt đầu đếm rồi đấy. Ông không muốn biết con số đâu.',
      'Đổi tab đi. Tôi đang đổi mặt.',
      'Cái này không còn là nghỉ giải lao nữa.',
      'Ông gọi đây là nghỉ, hay là trốn?'
    ],
    shopping: [
      'Ông đang thuyết phục chính mình. Tôi nghe hết rồi.',
      'Đóng tab đi. Sáng mai ông sẽ cảm ơn tôi.',
      'Món này giải quyết vấn đề gì? Nghĩ cho kỹ.',
      'Ví của ông không có ý kiến, nhưng tôi thì có.'
    ],
    other: [
      'Lâu rồi đấy. Ông nhận ra chưa?',
      'Tôi không giận. Tôi chỉ ghi lại thôi.',
      'Màn hình này đang thắng ông đấy.',
      'Quay lại việc đi, trước khi tôi đổi mặt.'
    ]
  },
  3: {
    social: [
      'Đủ rồi. Tôi không đùa nữa.',
      'Tay rời khỏi chuột. Ngay bây giờ.',
      'Ông tự chọn chỗ này, không phải tôi.',
      'Tôi sẽ đứng đây tới khi ông đứng dậy.'
    ],
    shopping: [
      'Không mua. Không phải hôm nay.',
      'Ông muốn mua thì nói lý do trước đã.',
      'Ông đã hứa với chính mình. Tôi nhớ hết.',
      'Đóng tab. Đừng để tôi nhắc lần nữa.'
    ],
    other: [
      'Ông đang phí thời gian của cả hai chúng ta.',
      'Tôi đổi mặt rồi. Ông định làm gì?',
      'Quay lại làm việc. Tôi đợi.',
      'Đây là lần cuối tôi nói nhẹ.'
    ]
  }
}

/** Categories the catalog may declare, mapped onto the three buckets that have lines. */
export function bucketFor(category: string): SiteBucket {
  if (category === 'social' || category === 'shopping') return category
  return 'other'
}
