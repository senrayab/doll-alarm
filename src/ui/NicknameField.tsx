// 대기열 닉네임 — 사이트 닉네임을 그대로 쓰거나, 이 대기열만 다른 닉네임으로
export interface NicknameValue {
  /** true = 사이트 정보의 닉네임을 따름 */
  useSite: boolean;
  nickname: string;
}

export function NicknameField({
  siteNickname,
  value,
  onChange,
  hint,
}: {
  siteNickname?: string;
  value: NicknameValue;
  onChange: (v: NicknameValue) => void;
  hint?: string;
}) {
  const site = siteNickname?.trim();
  const own = !site || !value.useSite;
  return (
    <div className="field">
      <span>내 닉네임 (유튜브 채널 닉네임)</span>
      {site && (
        <div className="chips">
          <button type="button" role="radio" aria-checked={value.useSite} className="chip" onClick={() => onChange({ ...value, useSite: true })}>
            {site}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={!value.useSite}
            className="chip"
            onClick={() => onChange({ useSite: false, nickname: value.nickname && value.nickname !== site ? value.nickname : '' })}
          >
            다른 닉네임으로
          </button>
        </div>
      )}
      {own && (
        <input
          value={value.nickname}
          onChange={(e) => onChange({ ...value, nickname: e.target.value })}
          placeholder={site ? '이 대기열에서 쓰는 닉네임' : '대기 명단에 표시되는 이름'}
          autoComplete="off"
        />
      )}
      <small>
        {site
          ? value.useSite
            ? '사이트 정보(ⓘ)에 적은 닉네임을 써요. 거기서 바꾸면 이 대기열도 같이 바뀌어요.'
            : '이 대기열에서만 다른 닉네임을 써요.'
          : (hint ?? '사이트 정보(ⓘ)에 닉네임을 적어 두면 다음부터 자동으로 들어가요.')}
      </small>
    </div>
  );
}

/** 실제로 쓸 닉네임 */
export const resolveNickname = (siteNickname: string | undefined, v: NicknameValue) =>
  (siteNickname?.trim() && v.useSite ? siteNickname.trim() : v.nickname.trim());
